import net from 'node:net'
import { createReadStream } from 'node:fs'
import type { AttachmentScanner, ScanRequest, ScanVerdict } from './types'

/**
 * ClamAV over its own wire protocol, using `INSTREAM`.
 *
 * `INSTREAM` rather than `SCAN <path>`: the daemon usually runs in a different
 * container from the app, so a path this process can see is not one clamd can.
 * Streaming the bytes over the socket is the only form that works in a
 * distributed deployment, and it is the form clamd documents for exactly that.
 */

const DEFAULT_PORT = 3310
const DEFAULT_TIMEOUT_MS = 30_000
/** clamd's own `StreamMaxLength` default; larger chunks are rejected outright. */
const CHUNK_BYTES = 64 * 1024

export type ClamAvScannerOptions = {
  host: string
  port?: number
  timeoutMs?: number
}

export class ClamAvScanner implements AttachmentScanner {
  readonly key = 'clamav'
  readonly inspects = true

  constructor(private readonly options: ClamAvScannerOptions) {}

  async scan(request: ScanRequest): Promise<ScanVerdict> {
    try {
      const response = await this.stream(request)
      return interpretClamAvResponse(response)
    } catch (error) {
      // Never an exception to the caller. A scanner that is down is an
      // operational problem, and the upload path answers it by keeping the file
      // unreadable and retryable rather than by failing the request in a way
      // that loses the bytes already stored.
      return {
        status: 'failed',
        reason: error instanceof Error ? error.message : 'clamav transport error',
      }
    }
  }

  private stream(request: ScanRequest): Promise<string> {
    const { host, port = DEFAULT_PORT, timeoutMs = DEFAULT_TIMEOUT_MS } = this.options

    return new Promise<string>((resolve, reject) => {
      const socket = net.createConnection({ host, port })
      let answer = ''
      let settled = false

      const finish = (error: Error | null) => {
        if (settled) return
        settled = true
        socket.destroy()
        if (error) reject(error)
        else resolve(answer)
      }

      socket.setTimeout(timeoutMs, () => finish(new Error('clamav scan timed out')))
      socket.on('error', (error) => finish(error))
      socket.on('data', (chunk) => {
        answer += chunk.toString('utf8')
      })
      socket.on('end', () => finish(null))

      socket.on('connect', () => {
        socket.write('zINSTREAM\0')

        // Each chunk is a 4-byte big-endian length followed by the bytes; a
        // zero-length chunk ends the stream and asks for the verdict.
        const writeChunk = (chunk: Buffer) => {
          const header = Buffer.alloc(4)
          header.writeUInt32BE(chunk.length, 0)
          socket.write(header)
          socket.write(chunk)
        }
        const endStream = () => socket.write(Buffer.from([0, 0, 0, 0]))

        if (request.buffer) {
          for (let at = 0; at < request.buffer.length; at += CHUNK_BYTES) {
            writeChunk(request.buffer.subarray(at, at + CHUNK_BYTES))
          }
          endStream()
          return
        }

        if (!request.filePath) {
          finish(new Error('clamav scan requires either a buffer or a file path'))
          return
        }

        const source = createReadStream(request.filePath, { highWaterMark: CHUNK_BYTES })
        source.on('data', (chunk) => writeChunk(chunk as Buffer))
        source.on('end', endStream)
        source.on('error', (error) => finish(error))
      })
    })
  }
}

/**
 * Turn clamd's one-line answer into a verdict.
 *
 * Exported for tests: the wire format is the part most likely to be misread,
 * and it is cheaper to assert against recorded responses than to stand up a
 * daemon.
 */
export function interpretClamAvResponse(response: string): ScanVerdict {
  const line = response.replace(/\0/g, '').trim()
  if (line.endsWith('OK')) return { status: 'clean' }
  if (line.endsWith('FOUND')) {
    // `stream: Eicar-Signature FOUND` -> `Eicar-Signature`
    const signature = line.replace(/^stream:\s*/i, '').replace(/\s*FOUND$/i, '').trim()
    return { status: 'infected', signature: signature.length > 0 ? signature : null }
  }
  return { status: 'failed', reason: line.length > 0 ? line : 'empty clamav response' }
}
