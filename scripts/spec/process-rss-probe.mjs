process.once('exit', () => {
  process.stderr.write(`[agon-slice1a-rss-kb]${process.resourceUsage().maxRSS}\n`);
});
