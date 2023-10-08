import { VideoContext } from '../video-context';
import { VideoNode, VideoNodeInfo } from './base';

export interface MixLayout {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex: number;
}
class NodeMixInfo {
  positionBuffer?: WebGLBuffer;
  constructor(public node: VideoNode, public layout: MixLayout) {
  }
  get x() {
    return this.layout.x || this.node.x;
  }
  get y() {
    return this.layout.y || this.node.y;
  }
  get width() {
    return this.layout.width || this.node.width;
  }
  get height() {
    return this.layout.height || this.node.height;
  }
  get right() {
    return this.x + this.width;
  }
  get bottom() {
    return this.y + this.height;
  }
}
export class VideoMixNode extends VideoNode {
  inputs: (NodeMixInfo | undefined)[] = [];
  constructor(context: VideoContext) {
    super(context, {
      useDefaultProgram: true,
      useFbo: true,
      name: 'mix',
      create2d: true
    });
  }
  addInput(node: VideoNode, layout: MixLayout) {
    if (this.inputs[layout.zIndex]) {
      throw new Error('input already exists');
    }
    const info = new NodeMixInfo(node, layout);
    this.inputs[layout.zIndex] = info;
  }
  resize(width: number, height: number): void {
    const size = this.inputs.reduce((size, input) => (input ? (Object.assign(size, { width: Math.max(size.width, input.right), height: Math.max(size.height, input.bottom) })) : size), { width: 0, height: 0 });
    super.resize(size.width, size.height);
    if (this.context._gl) {
      this.inputs.forEach(input => {
        if (input) {
          const data = this.layout2texCoords(input);
          if (input.positionBuffer) this.changeBufferData(input.positionBuffer!, data);
          else input.positionBuffer = this.createBuffer(data);
        }
      });
    }
  }
  connect<T extends VideoNode<TexImageSource>>(node: T, ...args: T extends VideoMixNode ? [MixLayout] : any[]): T {
    super.connect(node, ...args);
    this.resize(0, 0);
    return node;
  }
  removeInput(node: VideoNode) {
    this.inputs[this.inputs.findIndex(input => input?.node === node)] = void 0;
  }
  render(seq: number) {
    const gl = this.context._gl;
    const noframe = this.inputs.reduce((noframe, input) => (!input || !input.node.requestFrame(seq)) && noframe, true);
    if (!noframe && gl) {
      this.useProgram();
      gl.clearColor(0, 0, 0, 0); // 设置清空颜色
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); // 清空颜色缓冲区和深度缓冲区
      this.setAttributes({
        a_texCoord: this.texCoordBuffer
      });
      this.useBufferFrame(() => {
        for (let i = 0; i < this.inputs.length; i++) {
          const input = this.inputs[i];
          if (input) {
            // const layout = this.layouts.get(input)!;
            input.node.useTexture(gl => {
              this.setAttributes({
                a_position: input.positionBuffer!
              });
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            });
          }
        }
      });
      // // 获取纹理位置
      // const textureLocation1 = gl.getUniformLocation(this.program!, 'u_texture1');
      // const textureLocation2 = gl.getUniformLocation(this.program!, 'u_texture2');
      // // 绑定纹理到纹理单元
      // gl.activeTexture(gl.TEXTURE0);
      // gl.bindTexture(gl.TEXTURE_2D, this.bgNode!.texture!);
      // gl.uniform1i(textureLocation1, 0);

      // gl.activeTexture(gl.TEXTURE1);
      // gl.bindTexture(gl.TEXTURE_2D, this.texture!);
      // gl.uniform1i(textureLocation2, 1);
      return true;
    }
    return false;
  }
  render2d(seq: number): boolean {
    const noframe = this.inputs.reduce((noframe, input) => (!input || !input.node.requestFrame(seq)) && noframe, true);
    if (!noframe) {
      if (this.ctx2d) {
        this.ctx2d.clearRect(0, 0, this.width, this.height);
        for (let i = 0; i < this.inputs.length; i++) {
          const input = this.inputs[i];
          if (input) {
            this.draw2d(input.node.image, input.x, input.y, input.width, input.height);
          }
        }
        return true;
      }
    }
    return false;
  }
  getInfo(): { parent?: VideoNodeInfo | VideoNodeInfo[]; } & VideoNodeInfo {
    const { totalFrames, x, y, width, height } = this;
    const timestamp = Date.now();
    const fps = (totalFrames - this.lastInfo.totalFrames) / ((timestamp - this.lastInfo.timestamp) / 1000) >> 0;
    this.lastInfo = { totalFrames, x, y, width, height, timestamp, fps };
    return {
      parent: this.inputs.filter(input => input).map(input => input!.node.getInfo()),
      ...this.lastInfo
    };
  }
  close() {
    super.close();
    this.inputs.forEach(input => {
      if (input) {
        input.node?.disconnect();
        if (input.positionBuffer && this.context._gl) {
          try {
            this.context._gl.deleteBuffer(input.positionBuffer);
          } catch {
          }
        }
      }
    });
  }
}
