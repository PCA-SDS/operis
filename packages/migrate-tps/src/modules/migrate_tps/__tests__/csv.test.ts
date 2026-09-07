import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getTpsDataDir, parseTpsCsv, parseTpsCsvLine } from '../lib'

describe('TPS CSV fallback parsing', () => {
  describe('parseTpsCsvLine', () => {
    it('splits a plain record', () => {
      expect(parseTpsCsvLine('a,b,c')).toEqual(['a', 'b', 'c'])
    })

    it('keeps commas that live inside a quoted field', () => {
      // The reason branches.ts and resources.ts had to stop parsing the same
      // file two different ways: a naive split(',') shifts every later column.
      expect(parseTpsCsvLine('id-1,"Ho Chi Minh, District 1",Floor 3')).toEqual([
        'id-1',
        'Ho Chi Minh, District 1',
        'Floor 3',
      ])
    })

    it('unescapes a doubled quote inside a quoted field', () => {
      expect(parseTpsCsvLine('id-1,"The ""Loft"" Floor"')).toEqual(['id-1', 'The "Loft" Floor'])
    })

    it('preserves trailing empty columns', () => {
      expect(parseTpsCsvLine('id-1,benThanh,')).toEqual(['id-1', 'benThanh', ''])
    })
  })

  describe('parseTpsCsv', () => {
    const previousDataDir = process.env.TPS_DATA_DIR
    let tempDir: string

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tps-csv-'))
      process.env.TPS_DATA_DIR = tempDir
    })

    afterEach(() => {
      if (previousDataDir === undefined) delete process.env.TPS_DATA_DIR
      else process.env.TPS_DATA_DIR = previousDataDir
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('maps rows onto header keys rather than column positions', () => {
      fs.writeFileSync(
        path.join(tempDir, 'tps_floors.csv'),
        'id,location,name,sort_order\nf1,"Ho Chi Minh, District 1",Floor 3,3\nf2,thaoDien,Ground Floor,0\n',
      )
      expect(parseTpsCsv<{ location: string; name: string }>('tps_floors.csv')).toEqual([
        { id: 'f1', location: 'Ho Chi Minh, District 1', name: 'Floor 3', sort_order: '3' },
        { id: 'f2', location: 'thaoDien', name: 'Ground Floor', sort_order: '0' },
      ])
    })

    it('fills columns a short row omits instead of returning undefined', () => {
      fs.writeFileSync(path.join(tempDir, 'short.csv'), 'id,location,name\nf1,benThanh\n')
      expect(parseTpsCsv<Record<string, string>>('short.csv')).toEqual([
        { id: 'f1', location: 'benThanh', name: '' },
      ])
    })

    it('honours TPS_DATA_DIR over the packaged data directory', () => {
      expect(getTpsDataDir()).toBe(tempDir)
    })
  })
})
