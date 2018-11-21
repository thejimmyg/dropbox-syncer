const { DropboxSyncer } = require('../lib')

if (!process.env.DROPBOX_ACCESS_TOKEN) {
  console.error('No DROPBOX_ACCESS_TOKEN environment variable specified')
  process.exit()
}
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN
const DROPBOX_APP_ID = process.env.DROPBOX_APP_ID
if (!process.env.DROPBOX_SECRET) {
  console.error('No DROPBOX_SECRET environment variable specified')
  process.exit()
}
const DROPBOX_SECRET = process.env.DROPBOX_SECRET

let DROPBOX_REMOTE_FOLDER_PATH = process.env.DROPBOX_REMOTE_FOLDER_PATH || '/www'
if (DROPBOX_REMOTE_FOLDER_PATH[DROPBOX_REMOTE_FOLDER_PATH.length - 1] !== '/') {
  DROPBOX_REMOTE_FOLDER_PATH = DROPBOX_REMOTE_FOLDER_PATH + '/'
}
if (DROPBOX_REMOTE_FOLDER_PATH[0] !== '/') {
  DROPBOX_REMOTE_FOLDER_PATH = '/' + DROPBOX_REMOTE_FOLDER_PATH
}
const DROPBOX_LOCAL_FOLDER_PATH = process.env.DROPBOX_LOCAL_FOLDER_PATH || '/tmp/public'
const DROPBOX_SYNC_STATE_FOLDER_PATH = process.env.DROPBOX_SYNC_STATE_FOLDER_PATH || '/tmp/state'


const main = async () => {
  console.log('Syncing ...')
  ds = new DropboxSyncer(
    DROPBOX_ACCESS_TOKEN,
    DROPBOX_APP_ID,
    DROPBOX_SECRET,
    DROPBOX_REMOTE_FOLDER_PATH,
    DROPBOX_LOCAL_FOLDER_PATH,
    DROPBOX_SYNC_STATE_FOLDER_PATH
  )
  await ds.dropboxStatefulSync()
  console.log('done.')
}

main()
