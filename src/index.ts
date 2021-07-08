import * as path from 'path';
import { EventEmitter } from 'events';
import { default as ffmpeg } from 'fluent-ffmpeg';
import * as ytdl from 'ytdl-core';
import { default as progressStream } from 'progress-stream';
import { default as sanitizeFilename } from 'sanitize-filename';
import { existsSync, mkdirSync } from 'fs';

const BASE_URL = 'https://www.youtube.com/watch?v=';
const DEFAULT_BITRATE = 192;
const CHAR_REPLACES: [RegExp, string][] = [
	[/'/g, ''],
	[/\|/g, ''],
	[/'/g, ''],
	[/\//g, ''],
	[/\?/g, ''],
	[/:/g, ''],
	[/;/g, '']
];

export interface IOptions {
	fileName?: string;
	ffmpegPath?: string;
	outputPath?: string;
	// https://github.com/fent/node-ytdl-core/blob/0574df33f3382f3a825e4bef30f21e51cd78eafe/typings/index.d.ts#L7
	youtubeVideoQuality?: 'lowest' | 'highest' | string | number;
	queueParallelism?: number;
	progressTimeout?: number;
	allowWebm?: boolean;
	requestOptions?: any; // {}
    outputOptions?: any[];
}

export interface IProgress {
	videoId: string;
	// https://github.com/freeall/progress-stream#usage
	progress: {
		percentage: number;
		transferred: number;
		length: number;
		remaining: number;
		eta: number;
		runtime: number;
		delta: number;
		speed: number;
	};
}

export interface IResultStats {
    transferredBytes: number;
    runtime: number;
    averageSpeed: number;
}

export interface IResult {
    videoId: string;
    stats: IResultStats,
    file: string;
    youtubeUrl: string;
    videoTitle: string;
    artist: string;
    title: string;
    thumbnail: string;
}

function cleanFileName(fileName: string): string {
	CHAR_REPLACES.forEach(replacement => {
		fileName = fileName.replace(replacement[0], replacement[1]);
	});
	return fileName;
}

const DEFAULT_OPTIONS: IOptions = {
	outputPath: process.cwd(),
	youtubeVideoQuality: 'highestaudio',
	queueParallelism: 1,
	progressTimeout: 1000,
	allowWebm: false,
	requestOptions: { maxRedirects: 5 },
	outputOptions: [],
}

export class YoutubeToMp3Downloader extends EventEmitter {
	private readonly options: IOptions;

	constructor(public readonly videoId: string, options?: IOptions) {
		super();
		this.options = Object.assign({}, DEFAULT_OPTIONS, options ?? {});
		this._ensureDir();
	}

	public get videoUrl(): string { return `${BASE_URL}${this.videoId}`; }

	private _ensureDir(): void {
		const dir = this.options.outputPath ?? '';
		!existsSync(dir) && mkdirSync(dir);
	}

	private _downloadByInfo(info: ytdl.videoInfo, callback: (err: any, data: any) => void): void {
		let stats: IResultStats;
		const videoTitle = cleanFileName(info.videoDetails.title);
		let artist = 'Unknown';
		let title = 'Unknown';
		const thumbnail = (
			info.videoDetails.thumbnails
				? info.videoDetails.thumbnails[0].url
				: info.videoDetails.thumbnail?.thumbnails[0]?.url
		);

		if (videoTitle.indexOf('-') > -1) {
			const temp = videoTitle.split('-');
			if (temp.length >= 2) {
				artist = temp[0].trim();
				title = temp[1].trim();
			}
		} else {
			title = videoTitle;
		}

		const fileName = path.join(
			this.options.outputPath ?? '', 
			this.options.fileName ?? `${sanitizeFilename(videoTitle) || info.videoDetails.videoId}.mp3`,
		);

		const streamOptions: any = {
			quality: this.options.youtubeVideoQuality,
			requestOptions: this.options.requestOptions
		};

		if (!this.options.allowWebm) {
			streamOptions.filter = (format: any) => format.container === 'mp4';
		}

		const stream = ytdl.downloadFromInfo(info, streamOptions);

		stream.on('error', err => callback(err, null));

		stream.on('response', res => {
			const str = progressStream({
				length: parseInt(res.headers['content-length']),
				time: this.options.progressTimeout
			});

			//Add progress event listener
			str.on('progress', progress => {
				if (progress.percentage === 100) {
					stats = {
						transferredBytes: progress.transferred,
						runtime: progress.runtime,
						averageSpeed: parseFloat(progress.speed.toFixed(2))
					};
				}
				this.emit('progress', { videoId: this.videoId, progress: progress });
			});

			let outputOptions: string[] = [
				'-id3v2_version',
				'4',
				'-metadata',
				'title=' + title,
				'-metadata',
				'artist=' + artist
			];

			if (this.options.outputOptions) {
				outputOptions = outputOptions.concat(this.options.outputOptions);
			}

			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			const audioBitrate = info!.formats.find((format) => !!format.audioBitrate)!.audioBitrate ?? DEFAULT_BITRATE;

			//Start encoding
			ffmpeg({ source: stream.pipe(str) })
				.audioBitrate(audioBitrate)
				.withAudioCodec('libmp3lame')
				.toFormat('mp3')
				.outputOptions(...outputOptions)
				.on('error', (err: any) => callback(err, null))
				.on('end', () => {
					const resultObj: IResult = {
						videoId: this.videoId,
						stats,
						file: fileName,
						youtubeUrl: this.videoUrl,
						videoTitle: videoTitle,
						artist: artist,
						title: title,
						thumbnail: thumbnail,
					};
					callback(null, resultObj);
				})
				.saveToFile(fileName);
		});
	}

	public async download(): Promise<IResult> {
		const info: ytdl.videoInfo = await ytdl.getInfo(this.videoUrl);
		if (info == null) {
            throw new Error(`Invalid video url: ${this.videoUrl}`);
        }

		return new Promise<IResult>((resolve, reject) => {
			this._downloadByInfo(info, (err, data) => {
				if (err) return reject(err);
				resolve(data);
			});
		});
	}
}
