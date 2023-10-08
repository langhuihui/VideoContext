import { VideoTrackDestination } from './video-node/destination';
import { VideoImageSourceNode, VideoTrackSourceNode } from './video-node/source';
import { VideoNodeOptions } from './video-node/base';
import { ChangeState, FSM } from 'afsm';
const vertexShaderSource = `
// 顶点着色器
attribute vec4 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
  gl_Position = a_position;
  v_texCoord = a_texCoord;
}
`;
const fragmentShaderSource = `
// 片元着色器
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

void main() {
  gl_FragColor = texture2D(u_texture, v_texCoord);
} `;

export class VideoContext extends FSM<{ disconnect: [], unavailable: [string, Error?]; }> {
  frameRate: number;
  _canvas?: HTMLCanvasElement;
  // _offscreenCanvas: OffscreenCanvas = this._canvas.transferControlToOffscreen();
  _gl?: WebGLRenderingContext;
  ctx2d?: CanvasRenderingContext2D;
  defaultProgam: WebGLProgram;
  hasAlpha = false;
  glFaild = false;
  name: string;
  constructor(options: {
    name: string;
    frameRate: number;
    use2d?: boolean;
  }) {
    super();
    this.name = options.name;
    this.frameRate = options.frameRate;
  }
  @ChangeState(FSM.INIT, 'created')
  create(options: { alpha: boolean, use2d: boolean; }) {
    this.glFaild = false;
    this.hasAlpha = options.alpha;
    this._canvas = document.createElement('canvas');
    if (options.use2d) {
      this.ctx2d = this._canvas.getContext('2d', { alpha: options.alpha })!;
      return;
    }
    const gl = this._canvas.getContext('webgl', { alpha: options.alpha });
    if (gl) {
      this._gl = gl;
      try {
        const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
        this.defaultProgam = this.createProgram(vertexShader, fragmentShader);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        this._canvas.addEventListener('webglcontextlost', () => {
          this.destroy('webglcontextlost');
        });
      } catch (err) {
        return err as Error;
      }
    } else {
      this.ctx2d = this._canvas.getContext('2d')!;
    }
    if (!this.ctx2d && !this._gl) {
      delete this._canvas;
    }
  }
  get available() {
    return !!(this._canvas);
  }
  createVideoTrackSource(videoTrack: MediaStreamVideoTrack) {
    return new VideoTrackSourceNode(this, videoTrack);
  }
  // createMediaElementSource(video: HTMLVideoElement) {
  //   if (video instanceof HTMLVideoElement) {
  //     return new VideoTrackSourceNode(this, (video.captureStream() as MediaStream).getVideoTracks()[0]);
  //   }
  //   throw new Error('video is not HTMLVideoElement');
  // }
  createVideoTrackDestination(options?: VideoNodeOptions) {
    return new VideoTrackDestination(this, options);
  }
  createVideoImageSource(image: TexImageSource) {
    return new VideoImageSourceNode(this, image);
  }
  // getImageData() {
  //   return this._canvasCtx.getImageData(0, 0, this.width, this.height);
  // }
  set width(width: number) {
    this._gl?.viewport(0, 0, width, this.height);
    if (this._canvas) this._canvas.width = width;
  }
  get width() {
    return this._canvas?.width || 0;
  }
  set height(height: number) {
    this._gl?.viewport(0, 0, this.width, height);
    if (this._canvas) this._canvas.height = height;
  }
  get height() {
    return this._canvas?.height || 0;
  }
  setSize(width: number, height: number) {
    this._gl?.viewport(0, 0, width, height);
    if (this._canvas) {
      this._canvas.width = width;
      this._canvas.height = height;
    }
  }
  disconnect() {
    this.emit('disconnect');
  }
  @ChangeState('created', FSM.INIT, {
    ignoreError: true, success(this: VideoContext, result: [string, Error?]) {
      if (result[0]) {
        this.glFaild = true;
        this.emit('unavailable', ...result);
      }
      this.removeAllListeners();
    }
  })
  destroy(reason?: string, error?: Error) {
    this.disconnect();
    this._gl?.deleteProgram(this.defaultProgam);
    delete this._gl;
    delete this.ctx2d;
    if (this._canvas) {
      this._canvas.remove();
      this._canvas.width = 0;
      this._canvas.height = 0;
      delete this._canvas;
    }
    return [reason, error];
  }
  createShader(type: number, source: string) {
    const gl = this._gl!;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }

  createProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader) {
    const gl = this._gl!;
    const program = gl!.createProgram()!;
    gl!.attachShader(program, vertexShader);
    gl!.attachShader(program, fragmentShader);
    gl!.linkProgram(program);
    return program;
  }
  useTexture(texture: WebGLTexture, operation: (gl: WebGLRenderingContext) => any, index?: number) {
    const gl = this._gl!;
    gl.activeTexture(gl.TEXTURE0 + (index || 0));
    gl.bindTexture(gl.TEXTURE_2D, texture);
    operation(gl);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}
