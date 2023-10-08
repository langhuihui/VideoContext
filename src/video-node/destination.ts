import wtimer from 'wtimer';
import { VideoContext } from '../video-context';
import { VideoNode, VideoNodeOptions } from './base';

/**
 * 翻转：根据屏幕的坐标系统，需要使用翻转的坐标系
 *
 * 0,0---------1,0
 * |             |
 * |             |
 * |             |
 * 0,1---------1,1
 */
const texCoords = [
  0, 1, // 左下
  0, 0, // 左上
  1, 1, // 右下
  1, 0 // 右上
];
const timer = wtimer();
export class VideoDestinationNode extends VideoNode {
  private _intervalId = 0;
  private _sequence = 0;
  start(lastFrameRate: number) {
    this._intervalId = timer.setInterval(() => {
      if (lastFrameRate !== this.context.frameRate) {
        timer.clearInterval(this._intervalId);
        this.start(this.context.frameRate);
      }
      this.requestFrame(this._sequence++);
      const gl = this.context._gl;
      if (gl && gl.getError() !== gl.NO_ERROR) {
        this.context.destroy(`${this.name} req ${this._sequence} render ${this.totalFrames} faild ${gl.getError()}`);
      }
    }, 1000 / this.context.frameRate);
  }
  constructor(context: VideoContext, options?: VideoNodeOptions) {
    super(context, Object.assign({ useDefaultProgram: true, createTexture: false, name: 'destination' }, options));
    if (context._gl) this.setTexBuffer(texCoords);
    else if (context.ctx2d) this.ctx2d = context.ctx2d;
  }
  render(seq: number) {
    if (this.input?.requestFrame(seq)) {
      this.useProgram();
      this.useInputTexture(gl => {
        this.setAttributes({
          a_position: this.positionBuffer,
          a_texCoord: this.texCoordBuffer
        });
        // 绘制纹理
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      });
      return true;
    }
    return false;
  }
  addInput<T extends VideoNode>(node: T, ...args: any[]): void {
    super.addInput(node, ...args);
    this.start(this.context.frameRate);
  }
  removeInput(node: VideoNode): void {
    super.removeInput(node);
    timer.clearInterval(this._intervalId);
  }
}
export class VideoTrackDestination extends VideoDestinationNode {
  _videoTrack: MediaStreamVideoTrack;
  constructor(context: VideoContext, options?: VideoNodeOptions) {
    super(context, options);
    [this._videoTrack] = context._canvas!.captureStream(context.frameRate).getVideoTracks();
    const noFrame = () => {
      this._videoTrack.onmute = null;
      this.context.destroy('video track mute');
    };
    this._videoTrack.onmute = noFrame;
  }
  get videoTrack() {
    return this._videoTrack;
  }
  close() {
    super.close();
    this._videoTrack.onmute = null;
    this._videoTrack.stop();
  }
  resize(width: number, height: number) {
    super.resize(width, height);
    this.context.setSize(width, height);
  }
}

export class VideoFrameDestination extends VideoDestinationNode {
  getVideoFrame() {
    return new VideoFrame(this.context._canvas!);
  }
}

export class SmallVideoTrackDestination extends VideoTrackDestination {
  constructor(context: VideoContext, public resolution: { width: number, height: number; }) {
    super(context, { name: 'smallDestination' });
  }
  resize(width: number, height: number) {
    let ratio;
    const bigResolution = width * height;
    const smallResolution = this.resolution.width * this.resolution.height;
    // 如果大流是640 * 480，小流尺寸是 1080 * 720，即不满足
    if (bigResolution > smallResolution) {
      ratio = bigResolution / smallResolution;
    } else {
      ratio = bigResolution / (160 * 120);
    }
    super.resize(width / Math.sqrt(ratio), height / Math.sqrt(ratio));
  }
}
