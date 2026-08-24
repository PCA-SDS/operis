import { isAcceptableRedirectUri, redirectUriMatches } from '../lib/clients'

describe('redirect URI validation', () => {
  it('matches only on exact equality for https URIs', () => {
    expect(redirectUriMatches('https://app.example.com/cb', 'https://app.example.com/cb')).toBe(true)
    expect(redirectUriMatches('https://app.example.com/cb', 'https://app.example.com/cb2')).toBe(false)
  })

  it('refuses prefix-style matches (the classic open-redirect hole)', () => {
    expect(
      redirectUriMatches('https://app.example.com/cb', 'https://app.example.com/cb.attacker.com'),
    ).toBe(false)
    expect(
      redirectUriMatches('https://app.example.com/cb', 'https://app.example.com/cb/../../evil'),
    ).toBe(false)
    expect(redirectUriMatches('https://app.example.com/cb', 'https://app.example.com.evil/cb')).toBe(
      false,
    )
  })

  it('refuses a different host, scheme or query', () => {
    expect(redirectUriMatches('https://app.example.com/cb', 'https://evil.example.com/cb')).toBe(false)
    expect(redirectUriMatches('https://app.example.com/cb', 'http://app.example.com/cb')).toBe(false)
    expect(redirectUriMatches('https://app.example.com/cb', 'https://app.example.com/cb?x=1')).toBe(
      false,
    )
  })

  it('ignores only the port for loopback clients (RFC 8252)', () => {
    expect(redirectUriMatches('http://127.0.0.1:1234/cb', 'http://127.0.0.1:56789/cb')).toBe(true)
    expect(redirectUriMatches('http://localhost:1234/cb', 'http://localhost:9999/cb')).toBe(true)
    // Path still has to match exactly, even on loopback.
    expect(redirectUriMatches('http://127.0.0.1:1234/cb', 'http://127.0.0.1:1234/other')).toBe(false)
    // And the loopback exemption must not extend to remote hosts.
    expect(redirectUriMatches('http://example.com:80/cb', 'http://example.com:8080/cb')).toBe(false)
  })

  it('rejects unparseable input rather than throwing', () => {
    expect(redirectUriMatches('not a url', 'also not a url')).toBe(false)
  })
})

describe('acceptable redirect URI schemes', () => {
  it('accepts https anywhere', () => {
    expect(isAcceptableRedirectUri('https://app.example.com/cb', true)).toBe(true)
  })

  it('accepts http only for loopback', () => {
    expect(isAcceptableRedirectUri('http://127.0.0.1:8080/cb', true)).toBe(true)
    expect(isAcceptableRedirectUri('http://localhost:8080/cb', true)).toBe(true)
    // Plain http to a remote host would leak the code in transit.
    expect(isAcceptableRedirectUri('http://app.example.com/cb', true)).toBe(false)
  })

  it('accepts reverse-DNS private-use schemes for native apps', () => {
    expect(isAcceptableRedirectUri('com.example.app:/oauth', true)).toBe(true)
  })

  it('rejects script-bearing and file schemes', () => {
    expect(isAcceptableRedirectUri('javascript:alert(1)', false)).toBe(false)
    expect(isAcceptableRedirectUri('data:text/html,<script>', false)).toBe(false)
    expect(isAcceptableRedirectUri('file:///etc/passwd', false)).toBe(false)
  })

  it('rejects a URI carrying a fragment', () => {
    expect(isAcceptableRedirectUri('https://app.example.com/cb#frag', true)).toBe(false)
  })
})
