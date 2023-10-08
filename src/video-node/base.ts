import { ChangeState, FSM } from 'afsm';
import { VideoContext } from '../video-context';
import { MixLayout, VideoMixNode } from './mix';
/**
 * -1,1---------1,1
 * |             |
 * |             |
 * |             |
 *-1,-1---------1,-1
 *  */
const positions = [
  -1, -1, // 左下
  -1, 1, // 左上
  1, -1, // 右下
  1, 1 // 右上
];
/**
 * 0,1---------1,1
 * |             |
 * |             |
 * |             |
 * 0,0---------1,0
 */
const texCoords = [
  0, 0, // 左下
  0, 1, // 左上
  1, 0, // 右下
  1, 1 // 右上
];
export interface VideoNodeOptions {
  name: string;
  vertexShaderSource?: string;
  fragmentShaderSource?: string;
  useDefaultProgram?: boolean;
  createTexture?: boolean;
  create2d?: boolean;
  useFbo?: boolean;
  width?: number;
  height?: number;
  matchInputSize?: boolean;
}
export abstract class VideoNode<S extends TexImageSource = HTMLCanvasElement | OffscreenCanvas> extends FSM {
  name: string;
  input?: VideoNode<TexImageSource>;
  output?: VideoNode<TexImageSource>;
  // totalFrames = 0;
  // lastProcessTime = 0;
  texture?: WebGLTexture;
  image?: S;
  ctx2d: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  fbo?: WebGLFramebuffer;
  width = 0;
  height = 0;
  x = 0;
  y = 0;
  program?: WebGLProgram;
  vertexShader?: WebGLShader;
  fragmentShader?: WebGLShader;
  totalFrames = 0;
  dropFrames = 0;
  matchInputSize = true;
  texCoordBuffer: WebGLBuffer;
  positionBuffer: WebGLBuffer;
  lastInfo: VideoNodeInfo = {
    timestamp: 0,
    totalFrames: 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    fps: 0
  };
  _canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  constructor(public context: VideoContext, options: VideoNodeOptions) {
    super();
    this.context.once('disconnect', () => {
      if (this.state !== 'closed') this.close();
    });
    this.name = options.name;
    this.matchInputSize = options.matchInputSize !== false;
    this.width = options.width || context.width;
    this.height = options.height || context.height;
    const gl = context._gl;
    if (!gl) {
      if (context.ctx2d && options.create2d) {
        const _canvas = document.createElement('canvas');
        const canvas = typeof _canvas.transferControlToOffscreen === 'function' ? _canvas.transferControlToOffscreen() : _canvas;
        canvas.width = this.width;
        canvas.height = this.height;
        this.ctx2d = canvas.getContext('2d')! as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
        this.image = canvas as S;
        this._canvas = canvas;
      }
      return;
    }
    try {
      if (options.createTexture !== false) this.texture = gl.createTexture()!;
      this.texCoordBuffer = this.createBuffer(texCoords);
      this.positionBuffer = this.createBuffer(positions);
      this.useTexture(() => {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      });
      if (options.useFbo) {
        this.fbo = gl.createFramebuffer()!;
        this.useBufferFrame(() => {
          this.useTexture(() => {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture!, 0);
            // console.log('checkFramebufferStatus', gl.checkFramebufferStatus(gl.FRAMEBUFFER));
          });
        });
      }
      if (options.useDefaultProgram) this.program = this.context.defaultProgam;
      if (options.vertexShaderSource && options.fragmentShaderSource) {
        this.vertexShader = context.createShader(gl.VERTEX_SHADER, options.vertexShaderSource);
        this.fragmentShader = context.createShader(gl.FRAGMENT_SHADER, options.fragmentShaderSource);
        this.program = context.createProgram(this.vertexShader, this.fragmentShader);
      }
    } catch (err) {
      this.context.destroy(`${this.name} init failed`, err as Error);
    }
  }
  @ChangeState(FSM.INIT, 'connected')
  connect<T extends VideoNode<TexImageSource>>(node: T, ...args: (T extends VideoMixNode ? [MixLayout] : any[])) {
    node.addInput(this, ...args);
    this.output = node;
    return node;
  }
  addInput(node: VideoNode<TexImageSource>, ...args: any[]) {
    this.input = node;
    if (this.matchInputSize && node.width && node.height) this.resize(node.width, node.height);
  }
  requestFrame(seq: number) {
    const gl = this.context._gl;
    if ((gl && this.render(seq)) || (this.context.ctx2d && this.render2d(seq))) {
      this.totalFrames++;
    } else return false;
    return true;
  }
  abstract render(seq: number): boolean;
  render2d(seq: number) {
    if (this.input?.requestFrame(seq)) {
      return this.draw2d(this.input.image, 0, 0, this.width, this.height);
    }
    return false;
  }
  @ChangeState('connected', FSM.INIT, { ignoreError: true })
  disconnect(...args: any[]) {
    this.output?.removeInput(this, ...args);
    delete this.output;
  }
  removeInput(node: VideoNode<TexImageSource>, ...args: any[]) {
    delete this.input;
  }
  @ChangeState([], 'closed')
  close() {
    this.output?.removeInput(this);
    delete this.output;
    this.input?.disconnect();
    const gl = this.context._gl;
    if (gl) {
      gl.deleteBuffer(this.texCoordBuffer);
      gl.deleteBuffer(this.positionBuffer);
      if (this.fbo) gl.deleteFramebuffer(this.fbo);
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.vertexShader) gl.deleteShader(this.vertexShader);
      if (this.fragmentShader) gl.deleteShader(this.fragmentShader);
      if (this.program && this.program !== this.context.defaultProgam) gl.deleteProgram(this.program);
    }
    if (this._canvas) {
      this._canvas.width = 0;
      this._canvas.height = 0;
      this.ctx2d = null;
    }
    this.removeAllListeners();
  }
  useTexture(operation: (gl: WebGLRenderingContext) => any, index?: number) {
    if (this.texture) this.context.useTexture(this.texture, operation, index);
  }
  useInputTexture(operation: (gl: WebGLRenderingContext) => any, index?: number) {
    this.context.useTexture(this.input!.texture!, operation, index);
  }
  useProgram() {
    this.context._gl!.useProgram(this.program!);
  }
  useBufferFrame(operation: () => any) {
    const gl = this.context._gl!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo!);
    operation();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  createBuffer(data: Array<number>) {
    const gl = this.context._gl!;
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return b;
  }
  setTexBuffer(data: Array<number>) {
    const gl = this.context._gl!;
    const b = this.texCoordBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  }
  setPosBuffer(data: Array<number>) {
    const gl = this.context._gl!;
    const b = this.positionBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  }
  changeBufferData(b: WebGLBuffer, data: Array<number>) {
    const gl = this.context._gl!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  }
  setAttributes(attributes: Record<string, WebGLBuffer>) {
    const gl = this.context._gl!;
    for (const name in attributes) {
      const location = gl.getAttribLocation(this.program!, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, attributes[name]);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    }
  }
  getVertexPoint(x: number, y: number) {
    return [
      (x / this.width) * 2 - 1,
      (y / this.height) * 2 - 1
    ];
  }
  layout2texCoords(layout: { x: number, y: number, width: number, height: number; }) {
    return [
      ...this.getVertexPoint(layout.x, layout.y), // 左上->左下
      ...this.getVertexPoint(layout.x, layout.y + layout.height), // 左下->左上
      ...this.getVertexPoint(layout.x + layout.width, layout.y), // 右上->右下
      ...this.getVertexPoint(layout.x + layout.width, layout.y + layout.height) // 右下->右上
    ];
  }
  resize(width: number, height: number) {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    if (this._canvas) {
      this._canvas.width = width;
      this._canvas.height = height;
    }
    if (this.texture && this.fbo) {
      this.useTexture(gl => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null));
    }
    if (this.output && this.output.matchInputSize) this.output.resize(width, height);
  }

  draw2d(image: TexImageSource | undefined, dx: number, dy: number, dw: number, dh: number) {
    if (this.ctx2d && image) {
      if (image instanceof ImageData) {
        this.ctx2d.putImageData(image, dx, dy);
      } else {
        this.ctx2d.drawImage(image, dx, dy, dw, dh);
      }
      return true;
    }
    return false;
  }
  getInfo(): { parent?: VideoNodeInfo | VideoNodeInfo[]; } & VideoNodeInfo {
    const { totalFrames, x, y, width, height } = this;
    const timestamp = Date.now();
    const fps = (totalFrames - this.lastInfo.totalFrames) / ((timestamp - this.lastInfo.timestamp) / 1000) >> 0;
    this.lastInfo = { totalFrames, x, y, width, height, timestamp, fps };
    return {
      parent: this.input?.getInfo(),
      ...this.lastInfo
    };
  }
}
export interface VideoNodeInfo {
  timestamp: number,
  totalFrames: number, x: number, y: number, width: number, height: number, fps: number;
}
