// 对已脱敏的前后测量结果重新聚合；不读取账号、Cookie、直链或歌词原文。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const directory = path.resolve(root, process.argv[2] || 'docs/project/backend-overhaul-evidence');
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const percentile = (values, q) => values.length
  ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1] : null;
function metrics(rows) {
  const direct = rows.filter(r => r.playable && !r.fallback);
  const fallback = rows.filter(r => r.playable && r.fallback);
  const failed = rows.filter(r => !r.playable);
  const foreign = rows.filter(r => ['en', 'ja', 'ko'].includes(r.language));
  return {
    n: rows.length, playable: direct.length + fallback.length, direct: direct.length, fallback: fallback.length,
    directP50: percentile(direct.map(r => r.resolveMs), .5), directP95: percentile(direct.map(r => r.resolveMs), .95),
    fallbackP95: percentile(fallback.map(r => r.resolveMs), .95),
    failedP50: percentile(failed.map(r => r.resolveMs), .5), failedP95: percentile(failed.map(r => r.resolveMs), .95),
    maxMs: rows.length ? Math.max(...rows.map(r => r.resolveMs)) : null,
    wordUsable: rows.filter(r => r.usableWordLines > 0).length,
    wordRaw: rows.filter(r => r.wordRaw ?? r.word).length,
    foreign: foreign.length, translation: foreign.filter(r => r.translation).length,
  };
}
const result = {
  definitions: {
    word: '至少一行逐字正文与歌词正文在250ms内相同；原版也用相同测量器重算，不是原版UI观测值',
    translation: '翻译字段行数达到全部合并行的50%；接口返回覆盖，不是人工译文质量或音频对齐评分',
    time: '取得通过音频签名探测的地址，不是声卡出声；分位数使用nearest-rank',
  }, sets: {},
};
for (const set of ['public', 'challenge', 'unavailable']) {
  const before = read(set + '-before.json').rows, after = read(set + '-after.json').rows;
  result.sets[set] = { before: metrics(before), after: metrics(after), byPlatform: {}, byLanguage: {} };
  for (const field of ['platform', 'language']) {
    for (const value of new Set(before.map(r => r[field]))) {
      result.sets[set][field === 'platform' ? 'byPlatform' : 'byLanguage'][value] = {
        before: metrics(before.filter(r => r[field] === value)), after: metrics(after.filter(r => r[field] === value)),
      };
    }
  }
}
const samples = ['public-playlists.json', 'public-benchmark.json', 'unavailable-public.json']
  .flatMap(name => JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures', name), 'utf8')));
result.sampleRecords = samples.length;
result.uniqueIds = new Set(samples.map(t => t.platform + ':' + t.sourceId)).size;
for (const side of ['before', 'after']) {
  const rows = read('covers-' + side + '.json').rows;
  const verified = rows.filter(r => r.verified);
  result['covers' + side] = {
    n: rows.length, verified: verified.length,
    large: verified.filter(r => r.width >= 760 && r.height >= 760).length,
    largest: [...verified].sort((a, b) => b.width * b.height - a.width * a.height)[0] || null,
  };
}
result.frames = {};
for (const [name, value] of Object.entries(read('media.json').variants)) {
  result.frames[name] = {
    frameP50: percentile(value.frames.frameMs, .5), frameP95: percentile(value.frames.frameMs, .95),
    frameMax: Math.max(...value.frames.frameMs), clickP50: percentile(value.frames.clickToTwoFramesMs, .5),
    clickP95: percentile(value.frames.clickToTwoFramesMs, .95), longTasks: value.frames.longTasksMs.length,
    gapP50: percentile(value.media.gapsMs, .5), gapP95: percentile(value.media.gapsMs, .95),
  };
}
fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`已重新聚合 ${result.sampleRecords} 条公开样本记录，${result.uniqueIds} 个平台歌曲 ID。`);
