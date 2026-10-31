#!/usr/bin/env node
// Painted portraits from prompts.json, via the image generation tool of the Codex CLI (see README.md).
//   node paint.js gen [id ...] --masters DIR [--per 3] [--jobs 3]   paint masters (DIR/<id>.png, full size)
//   node paint.js out [id ...] --masters DIR                        crop + resize masters into the game's images
// ids default to every entry. gen keeps a replaced master in DIR/old/.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');

const IMAGES = path.join(__dirname, '..', '..', 'src', 'Souls.Web', 'wwwroot', 'Content', 'Images');
const { cards } = JSON.parse(fs.readFileSync(path.join(__dirname, 'prompts.json'), 'utf8'));

function parseArgs(argv) {
    const a = { cmd: argv[0], ids: [], masters: null, per: 3, jobs: 3 };
    for (let i = 1; i < argv.length; i++) {
        if (argv[i] === '--masters') a.masters = path.resolve(argv[++i]);
        else if (argv[i] === '--per') a.per = Number(argv[++i]);
        else if (argv[i] === '--jobs') a.jobs = Number(argv[++i]);
        else a.ids.push(argv[i]);
    }
    if (!['gen', 'out'].includes(a.cmd) || !a.masters) {
        console.error('usage: node paint.js gen|out [id ...] --masters DIR [--per N] [--jobs N]');
        process.exit(2);
    }
    return a;
}

function codex(dir, batch) {
    const list = batch.map((c, i) => `Image ${i + 1}: file ${c.id}.png. Prompt:\n${c.prompt}`).join('\n\n');
    const task = `Use your built-in image generation tool to create ${batch.length} separate images, one tool call per image. ` +
        'Pass each prompt below to the tool exactly as written, without rewriting, shortening or adding to it. ' +
        'Copy each generated PNG file unchanged (do not resize, crop, convert or edit it) into the current directory ' +
        'under the given file name. Do not create any other files. Finally print each file name and its pixel size.\n\n' + list;
    return new Promise(resolve => {
        const p = spawn('codex', ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-C', dir, task],
            { stdio: ['ignore', fs.openSync(path.join(dir, 'codex.log'), 'w'), 'inherit'] });
        p.on('close', resolve);
    });
}

async function gen(args, selected) {
    const batches = [];
    for (let i = 0; i < selected.length; i += args.per) batches.push(selected.slice(i, i + args.per));
    fs.mkdirSync(path.join(args.masters, 'old'), { recursive: true });
    const run = async batch => {
        const dir = fs.mkdtempSync(path.join(args.masters, 'work-'));
        const code = await codex(dir, batch);
        for (const c of batch) {
            const src = path.join(dir, `${c.id}.png`), dst = path.join(args.masters, `${c.id}.png`);
            if (!fs.existsSync(src)) { console.log(`${c.id}: missing (codex exit ${code}, log ${dir}/codex.log)`); continue; }
            if (fs.existsSync(dst)) fs.renameSync(dst, path.join(args.masters, 'old', `${c.id}-${Date.now()}.png`));
            fs.renameSync(src, dst);
            const m = await sharp(dst).metadata();
            console.log(`${c.id}: ${m.width}x${m.height} ${c.name}`);
        }
    };
    const queue = [...batches];
    await Promise.all(Array.from({ length: args.jobs }, async () => { while (queue.length) await run(queue.shift()); }));
}

async function out(args, selected) {
    for (const c of selected) {
        const [w, h] = c.size;
        const dst = path.join(IMAGES, c.file);
        // Every client stretches the whole image into a fixed box (cards 236x167, heroes 300x250), so the master is
        // cropped to that aspect around its centre, never stretched.
        let img = sharp(path.join(args.masters, `${c.id}.png`)).removeAlpha().toColorspace('srgb')
            .resize(w, h, { fit: 'cover', position: c.position || 'centre', kernel: 'lanczos3' });
        img = dst.endsWith('.png') ? img.png({ compressionLevel: 9, palette: true, quality: 95, dither: 0.6 })
            : img.jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:4:4' });
        const buf = await img.toBuffer();
        fs.writeFileSync(dst, buf);
        console.log(`${String(c.id).padEnd(10)} ${c.file.padEnd(28)} ${w}x${h} ${(buf.length / 1024).toFixed(0)} KB`);
    }
}

const args = parseArgs(process.argv.slice(2));
const selected = args.ids.length ? cards.filter(c => args.ids.includes(String(c.id))) : cards;
if (!selected.length) throw new Error('no entries selected');
(args.cmd === 'gen' ? gen : out)(args, selected).catch(e => { console.error(e); process.exit(1); });
