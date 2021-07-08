import { YoutubeToMp3Downloader, IProgress } from './src';

async function download(videoId: string) {
    const downloader = new YoutubeToMp3Downloader(videoId);
    downloader.on('progress', (e: IProgress) => {
        console.log(`Downloaded [${e.videoId}] ${Math.round(e.progress.percentage * 100) / 100} %`);
    });
    await downloader.download();
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length == 0) {
        console.log('Usage: npx ts-node download.ts <video-id1> <video-id2> ...');
        return;
    }

    for (const vid of args) {
        await download(vid);
    }
}

main();
