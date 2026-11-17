// 原机器无需设置；换机器可指定依赖目录和浏览器，也支持项目内安装。
const path = require('node:path');
const fs = require('node:fs');
const legacyModules = 'C:/Users/LIU/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
function qaRequire(name) {
  const roots = [process.env.NEBULA_QA_MODULES, legacyModules].filter(Boolean);
  for (const root of roots) {
    const target = path.join(root, name);
    if (fs.existsSync(target)) return require(target);
  }
  try { return require(name); } catch {
    throw new Error(`QA 缺少 ${name}；请设置 NEBULA_QA_MODULES 或安装该测试依赖`);
  }
}
const chrome = process.env.NEBULA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
module.exports = { qaRequire, chrome };
