'use strict'
const t = require('tap')

const realPlatform = process.platform
const fakePlatform = realPlatform === 'win32' ? 'posix' : 'win32'
const modulePath = require.resolve('../lib/normalize-windows-path.js')

// tap 12 has no t.mock(), so re-require the module with a cleared cache
// after toggling the platform-faking env var.
const load = _ => {
  delete require.cache[modulePath]
  return require(modulePath)
}

t.teardown(_ => {
  delete process.env.TESTING_TAR_FAKE_PLATFORM
  delete require.cache[modulePath]
})

t.test('posix', t => {
  if (realPlatform === 'win32')
    process.env.TESTING_TAR_FAKE_PLATFORM = fakePlatform
  else
    delete process.env.TESTING_TAR_FAKE_PLATFORM
  const normPath = load()
  t.equal(normPath('/some/path/back\\slashes'), '/some/path/back\\slashes')
  t.equal(normPath('c:\\foo\\bar'), 'c:\\foo\\bar')
  t.end()
})

t.test('win32', t => {
  if (realPlatform !== 'win32')
    process.env.TESTING_TAR_FAKE_PLATFORM = fakePlatform
  else
    delete process.env.TESTING_TAR_FAKE_PLATFORM
  const normPath = load()
  t.equal(normPath('/some/path/back\\slashes'), '/some/path/back/slashes')
  t.equal(normPath('c:\\foo\\bar'), 'c:/foo/bar')
  t.end()
})
