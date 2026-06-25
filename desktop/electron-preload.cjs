const { contextBridge } = require('electron');

const arg = process.argv.find((a) => a.startsWith('--bridge-admin-token='));
const token = arg ? decodeURIComponent(arg.slice('--bridge-admin-token='.length)) : '';

try {
  contextBridge.exposeInMainWorld('__bridgeAdminToken', token);
} catch {
  /* ignore duplicate expose */
}
