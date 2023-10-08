import { VideoContext } from '../video-context';
import { VideoNode } from './base';

export class VideoImageSourceNode<S extends TexImageSource = TexImageSource> extends VideoNode<S> {
  private _image: S;
  private _totalFrames = 0;
  constructor(context: VideoContext, public image: S) {
    super(context, { name: 'imageSource' });
  }
  private _render(seq: number, gl: boolean) {
    let { width, height } = this;
    if (this.image instanceof HTMLVideoElement) {
      if (typeof this.image.getVideoPlaybackQuality === 'function') {
        const q = this.image.getVideoPlaybackQuality();
        const totalFrames = q.totalVideoFrames;
        if (this._totalFrames === totalFrames) return false;
        this._totalFrames = totalFrames;
        this.dropFrames = this._totalFrames - this.totalFrames;
      } else { }
      ({ videoWidth: width, videoHeight: height } = this.image);
    } else if (this.image instanceof HTMLImageElement || this.image instanceof ImageData || this.image instanceof ImageBitmap) {
      ({ width, height } = this.image);
      if (this.image !== this._image) {
        this._image = this.image;
      } else if (width === this.width && height === this.height) {
        return false;
      }
    } else if (this.image instanceof HTMLCanvasElement || this.image instanceof OffscreenCanvas) {
      ({ width, height } = this.image);
      this._image = this.image;
    }
    if (this.width === width && this.height === height && this.totalFrames) {
      if (gl) this.useTexture(gl => {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
      });
    } else {
      if (gl) this.useTexture(gl => {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
      });
      this.resize(width, height);
    }
    return true;
  }
  render(seq: number) {
    return this._render(seq, true);
  }
  render2d(seq: number): boolean {
    return this._render(seq, false);
  }
}
export class VideoTrackSourceNode extends VideoImageSourceNode<HTMLVideoElement> {
  private _mediaStream?: MediaStream;
  constructor(context: VideoContext, private _videoTrack: MediaStreamVideoTrack) {
    super(context, document.createElement('video'));
    this.name = 'videoTrackSource';
    this._mediaStream = new MediaStream([_videoTrack]);
    this.image.srcObject = this._mediaStream;
    this.image.play();
    // new MediaStreamTrackProcessor({ track: videoTrack }).readable.pipeTo(new WritableStream({
    //   write: (video: VideoFrame) => {
    //     this._currentFrame?.close();
    //     this._currentFrame = video.clone();
    //     video.close();
    //   }
    // }));
  }
  replaceTrack(track: MediaStreamVideoTrack) {
    if (this._videoTrack !== track) {
      this._mediaStream?.removeTrack(this._videoTrack);
      this._videoTrack = track;
      this._mediaStream?.addTrack(this._videoTrack);
      this.image.play();
    }
  }
  close(): void {
    super.close();
    delete this._mediaStream;
    this.image.srcObject = null;
  }
}
