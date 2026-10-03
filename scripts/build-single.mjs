// Builds the game into ONE self-contained HTML file (JS + CSS inlined) at
// artifact/waymo-vs-cybertaxi.html. The output omits <!doctype>/<head>/<body> so it can be
// wrapped by hosts that provide their own document skeleton; it also opens fine on its own.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

execSync('npx vite build --config vite.single.config.js', { stdio: 'inherit' });
const dist = 'dist-single';
const assets = readdirSync(join(dist, 'assets'));
const js = assets.filter((f) => f.endsWith('.js'));
const css = assets.filter((f) => f.endsWith('.css'));
if (js.length !== 1) throw new Error('expected exactly one JS bundle, got: ' + js.join(', '));
const code = readFileSync(join(dist, 'assets', js[0]), 'utf8').replace(/<\/script/gi, '<\\/script');
const styles = css.map((f) => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n');
const html = `<meta charset="utf-8">
<title>Waymo vs Cybertaxi</title>
<meta name="description" content="A Crazy Taxi style robotaxi battle through the hills of San Francisco.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bungee&family=Russo+One&family=Inter:wght@400;600;800;900&family=Nunito:wght@800&display=swap" rel="stylesheet">
<style>
:root { color-scheme: dark; }
${styles}
</style>
<div id="app"></div>
<div id="ui"></div>
<script type="module">
${code}
</script>
`;
mkdirSync('artifact', { recursive: true });
writeFileSync('artifact/waymo-vs-cybertaxi.html', html);
console.log('wrote artifact/waymo-vs-cybertaxi.html', (html.length / 1024 / 1024).toFixed(2), 'MB');
