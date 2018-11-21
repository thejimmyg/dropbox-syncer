const crypto = require('crypto')
const fetch = require('isomorphic-fetch')
const Dropbox = require('dropbox').Dropbox
const path = require('path')
const shell = require('shelljs')
const fs = require('fs')
const { promisify } = require('util')

// Config


// Globals

const writeFileAsync = promisify(fs.writeFile)
const readFileAsync = promisify(fs.readFile)
const unlinkAsync = promisify(fs.unlink)

// Webhook

class DropboxSyncer {

  constructor (
    DROPBOX_ACCESS_TOKEN,
    DROPBOX_APP_ID,
    DROPBOX_SECRET,
    DROPBOX_REMOTE_FOLDER_PATH,
    DROPBOX_LOCAL_FOLDER_PATH,
    DROPBOX_SYNC_STATE_FOLDER_PATH,
  ) {
    console.log(`INIT ${DROPBOX_ACCESS_TOKEN}`)
    this.DROPBOX_ACCESS_TOKEN = DROPBOX_ACCESS_TOKEN
    this.DROPBOX_APP_ID = DROPBOX_APP_ID
    this.DROPBOX_SECRET = DROPBOX_SECRET
    this.DROPBOX_REMOTE_FOLDER_PATH = DROPBOX_REMOTE_FOLDER_PATH
    this.DROPBOX_LOCAL_FOLDER_PATH = DROPBOX_LOCAL_FOLDER_PATH
    this.DROPBOX_SYNC_STATE_FOLDER_PATH = DROPBOX_SYNC_STATE_FOLDER_PATH

    this.dbx = new Dropbox({ accessToken: this.DROPBOX_ACCESS_TOKEN, fetch })
    shell.mkdir('-p', this.DROPBOX_LOCAL_FOLDER_PATH)
    shell.mkdir('-p', this.DROPBOX_SYNC_STATE_FOLDER_PATH)
  }

  async setupApp(app) {
    // You can verify the authenticity of the request by looking at the X-Dropbox-Signature header, which will contain the HMAC-SHA256 signature of the entire request body using your app secret as the key.
    // MUST come before body-parser so we can check the signature
    // https://stackoverflow.com/questions/9920208/expressjs-raw-body
    app.all('/webhook', async (req, res, next) => {
      if (req.method === 'GET' && req.query.hasOwnProperty('challenge')) {
        console.log(req.query['challenge'])
        res.append('Content-Type', 'text/plain')
        res.append('X-Content-Type-Options', 'nosniff')
        res.send(req.query['challenge'])
      } else {
        let data = ''
        req.setEncoding('utf8')
        req.on('data', (chunk) => {
          data += chunk
        })
        req.on('end', async () => {
          const hmac = crypto.createHmac('SHA256', this.DROPBOX_SECRET)
          hmac.update(data)
          const hash = hmac.digest('hex')
          if (req.get('X-Dropbox-Signature') === hash) {
            const hook = JSON.parse(data)
            console.log(hook)
            if (this.DROPBOX_APP_ID && (hook.list_folder.accounts[0] !== this.DROPBOX_APP_ID)) {
              console.error('Unknown App ID')
              res.status(500)
              res.send('Unknown App ID')
            } else {
              await this.dropboxStatefulSync()
              res.send('OK')
            }
          } else {
            console.error('Invalid Signature')
            res.status(500)
            res.send('Invalid Signature')
          }
        })
      }
    })
  }

  async syncOne(remotePath) {
    console.log('Syncing', remotePath)
    const {dir, filename, dest} = await this.remoteToLocal(remotePath)
    console.log(dir, filename, dest)
    shell.mkdir('-p', dir)
    let fileDownload
    try {
      // TODO: Replace with fetch() directly
      fileDownload = await this.dbx.filesDownload({ path: remotePath })
      await writeFileAsync(dest, fileDownload.fileBinary, { encoding: 'utf8' })
    } catch (e) {
      console.error(e)
      if (e.response.statusText.substring(0, 14) === 'path/not_found') {
        console.error('Not found')
      } else {
        console.error('Could not get file', e)
      }
      return false
    }
    console.log(`Saved to ${dest}`)
    return true
  }

  async getChanges (cursor) {
    console.log(`Bearer ${this.DROPBOX_ACCESS_TOKEN}`)
    const res = await fetch(
      'https://api.dropboxapi.com/2/files/list_folder/continue',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.DROPBOX_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ cursor })
      }
    )
    let deleted = {}
    let changed = {}
    console.log(res.status)
    if (res.status !== 200) {
      throw new Error(await res.text())
    }
    const text = await res.text()
    const json = JSON.parse(text)
    console.log('JSON', json)
    for (let i = 0; i < json.entries.length; i++) {
      const contentHash = json.entries[i].content_hash
      const id = json.entries[i].id
      if (json.entries[i]['.tag'] === 'file') {
        if (json.entries[i].path_display.startsWith(this.DROPBOX_REMOTE_FOLDER_PATH)) {
          changed[json.entries[i].path_display] = { contentHash, id }
          // console.log(json.entries[i].path_display)
        } else {
          console.log('Skipping', json.entries[i].path_display)
        }
      } else if (json.entries[i]['.tag'] === 'deleted') {
        console.log('DELETED', json.entries[i].path_display)
        deleted[json.entries[i].path_display] = { contentHash, id }
      }
    }
    console.log(deleted)
    cursor = json.cursor
    // console.log('Result', changed)
    if (json.has_more) {
      const next = await this.getChanges(cursor)
      changed = Object.assign(changed, next.changed)
      deleted = Object.assign(deleted, next.deleted)
      cursor = next.cursor
    }
    return { changed, cursor, deleted}
  }

  async getCursor () {
    // Load from the filename
    try {
      const data = await readFileAsync(path.join(this.DROPBOX_SYNC_STATE_FOLDER_PATH, 'cursor.json'), { encoding: 'utf8' })
      const cursor = JSON.parse(data)
      return cursor
    } catch (e) {
      // Otherwise get a new cursor from the list_folder call with the correct path
      const body = JSON.stringify({ 'path': this.DROPBOX_REMOTE_FOLDER_PATH, 'recursive': true })
      console.log(`Bearer ${this.DROPBOX_ACCESS_TOKEN}`)
      const res = await fetch(
        'https://api.dropboxapi.com/2/files/list_folder',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.DROPBOX_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body
        }
      )
      console.log(res.statusText)
      if (res.status !== 200) {
        throw new Error(await res.text())
      }
      const text = await res.text()
      const json = JSON.parse(text)
      return json.cursor
    }
  }

  async setCursor (cursor) {
    console.log('Writing cursor', cursor)
    await writeFileAsync(path.join(this.DROPBOX_SYNC_STATE_FOLDER_PATH, 'cursor.json'), JSON.stringify(cursor), { encoding: 'utf8' })
  }

  async remoteToLocal (remotePath) {
    console.log('--------', remotePath, this.DROPBOX_LOCAL_FOLDER_PATH)
    const localPath = path.join(this.DROPBOX_LOCAL_FOLDER_PATH, remotePath.slice(this.DROPBOX_REMOTE_FOLDER_PATH.length, remotePath.length))
    const parts = localPath.split('/')
    const filename = parts[parts.length - 1]
    const dir = parts.slice(0, parts.length - 1).join('/')
    const dest = path.join(dir, filename)
    console.log('+++++++++', {dest, dir, filename})
    return {dest, dir, filename}
  }

  async deleteOne (remotePath) {
    console.log(`Need to delete ${remotePath}`)
    const {dest} = await this.remoteToLocal(remotePath)
    await unlinkAsync(dest)
    console.log(`Deleted ${dest}`)
    return true
  }

  async syncDropbox (startCursor) {
    const { changed, deleted, cursor } = await this.getChanges(startCursor)
    console.log('Got new cursor', cursor)
    console.log('Got deleted', deleted)

    const deletes = []
    for (let deletedPath in deleted) {
      if (deleted.hasOwnProperty(deletedPath)) {
        deletes.push(await this.deleteOne(deletedPath))
      }
    }

    const downloads = []
    for (let changedPath in changed) {
      if (changed.hasOwnProperty(changedPath)) {
        const self = this;
        downloads.push((async function (changedPath) {
          const success = await self.syncOne(changedPath)
          if (success) {
            console.log(`Synced ${changedPath}`)
            return success
          } else {
            console.log(`Failed to sync ${changedPath}`)
            return false
          }
        }(changedPath)))
      }
    }
    console.log('Returning new cursor', cursor)
    return { cursor, downloads, deletes }
  }

  async dropboxStatefulSync () {
    const startCursor = await this.getCursor()
    console.log('Got cursor', startCursor)
    // We assume that the call above only sends the folder itself
    const { cursor, downloads, deletes } = await this.syncDropbox(startCursor)
    console.log('Waiting for deletes', deletes)
    await Promise.all(deletes)
    console.log('Waiting for downloads', downloads)
    await Promise.all(downloads)
    console.log('Saving cursor to disk', cursor)
    await this.setCursor(cursor)
  }
}

module.exports = {DropboxSyncer}
