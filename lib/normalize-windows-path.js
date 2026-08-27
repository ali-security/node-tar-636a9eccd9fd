// on windows, either \ or / are valid directory separators.
// on unix, \ is a valid character in filenames.
// so, on windows, and only on windows, we replace all \ chars with /,
// so that we can use / as our one and only directory separator char.

// Always hand back a string: a pax header can carry a path that looks like a
// number, and everything downstream of here does string work on it.
const platform = process.env.TESTING_TAR_FAKE_PLATFORM || process.platform
module.exports = platform !== 'win32' ? p => String(p)
  : p => String(p).replace(/\\/g, '/')
