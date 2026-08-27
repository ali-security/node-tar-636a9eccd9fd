'use strict'

const t = require('tap')
const normalizeUnicode = require('../lib/normalize-unicode.js')

// These are the characters that macOS's APFS case-folds onto their expanded
// spelling, so a file named 'ﬀ' and a file named 'FF' are the same file there.
// The cache keys tar compares have to fold them the same way the file system
// does, or a symbolic link can be laid down over a path tar still believes is
// a plain directory (GHSA-r6q2-hw4h-h46w).
//
// The fold decomposes first, so the expectation for U+1E9B is the decomposed
// 'S' + COMBINING DOT ABOVE rather than the precomposed U+1E60.  That one is
// spelled with an escape so it survives a tool that renormalizes source.
const cases = [
  ['ﬀ', 'FF'], // ﬀ LATIN SMALL LIGATURE FF
  ['ﬁ', 'FI'], // ﬁ LATIN SMALL LIGATURE FI
  ['ﬂ', 'FL'], // ﬂ LATIN SMALL LIGATURE FL
  ['ﬃ', 'FFI'], // ﬃ LATIN SMALL LIGATURE FFI
  ['ﬄ', 'FFL'], // ﬄ LATIN SMALL LIGATURE FFL
  ['ﬅ', 'ST'], // ﬅ LATIN SMALL LIGATURE LONG S T
  ['ﬆ', 'ST'], // ﬆ LATIN SMALL LIGATURE ST
  ['ẛ', 'S\u0307'], // ẛ LATIN SMALL LETTER LONG S WITH DOT ABOVE
  ['ß', 'SS'], // ß LATIN SMALL LETTER SHARP S
  ['ẞ', 'SS'], // ẞ LATIN CAPITAL LETTER SHARP S
  ['ſ', 'S'] // ſ LATIN SMALL LETTER LONG S
]

cases.forEach(c => {
  const from = c[0]
  const to = c[1]
  t.equal(normalizeUnicode(from), to,
    JSON.stringify(from) + ' folds to ' + JSON.stringify(to))
  // the collision only matters if the expanded spelling is a fixed point
  t.equal(normalizeUnicode(to), to,
    JSON.stringify(to) + ' folds to itself')
})

// NFKD + toLowerCase(), which is what the cache keys used before this fix,
// leaves these two looking like unrelated paths.  Assert the collision
// directly so a regression in the folding is caught here and not only in the
// unpack tests that depend on it.
t.equal(normalizeUnicode('ß'), normalizeUnicode('SS'),
  'sharp s and SS land on the same key')
t.equal(normalizeUnicode('ﬀ'), normalizeUnicode('ff'),
  'the ff ligature and ff land on the same key')

// exercise both sides of the memoization branch
t.equal(normalizeUnicode('memo/ß'), 'MEMO/SS', 'first call folds')
t.equal(normalizeUnicode('memo/ß'), 'MEMO/SS', 'second call is cached')

// separators and ascii are left structurally alone
t.equal(normalizeUnicode('a/b/c'), 'A/B/C', 'ascii paths just upcase')
