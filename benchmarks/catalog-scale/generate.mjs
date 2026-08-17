const pad = (value, width) => String(value).padStart(width, '0')

/** Deterministic synthetic metadata; no fixture is checked in. */
export function generateCatalog(size) {
  const width = Math.max(4, String(size - 1).length)
  return Array.from({ length: size }, (_, index) => {
    const kind = index % 3 === 0 ? 'tool' : index % 3 === 1 ? 'skill' : 'mcp'
    const token = pad(index, width)
    const id = `${kind}:synthetic_${token}`
    const special = index === 7
    return {
      id,
      kind,
      name: special ? `exact_lookup_${token}` : `common_lookup_${token}`,
      description: index % 11 === 0
        ? `Lookup precipitation and climate records for synthetic item ${token}.`
        : `Common catalog capability ${token} for deterministic scale testing.`,
      whenToUse: index % 17 === 0
        ? `Use this rare meteorological action for item ${token}.`
        : 'Use for a common catalog request.',
      keywords: [
        'common',
        `${kind}_keyword`,
        ...(special ? [`exact_keyword_${token}`, 'rare'] : []),
      ],
      source: index % 5 === 0 ? 'builtin' : 'local',
      trust: index % 5 === 0 ? 'builtin' : 'trusted',
      providerId: `synthetic-provider-${index % 32}`,
      ptcCompatible: kind === 'tool' && index % 2 === 0,
    }
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const size = Number(process.argv[2] ?? '1000')
  if (!Number.isInteger(size) || size < 1) throw new Error('size must be a positive integer')
  console.log(JSON.stringify({ size, deterministic: true, fixture: 'generated in memory' }))
}
