import { VideoContext } from '../video-context';
import { VideoNode } from './base';

const texCoords = [
  1, 0, // 右下
  1, 1, // 右上
  0, 0, // 左下
  0, 1 // 左上
];
export class VideoMirrorNode extends VideoNode {
  constructor(context: VideoContext) {
    super(context, {
      useDefaultProgram: true,
      useFbo: true,
      create2d: true,
      name: 'mirror'
    });
    if (context._gl) {
      try {
        this.setTexBuffer(texCoords);
      } catch (err) {
        context.destroy('mirror set texCoords faild', err as Error);
      }
    } else if (this.ctx2d) {
      // 不能马上调用 scale，会导致失效
      setTimeout((ctx2d: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
        ctx2d.scale(-1, 1);
        ctx2d.translate(-this.width, 0);
      }, 0, this.ctx2d);
    }
  }
  render(seq: number) {
    if (this.input?.requestFrame(seq)) {
      this.useProgram();
      this.useBufferFrame(() => {
        // 绑定你想要镜像的纹理
        this.useInputTexture(gl => {
          this.setAttributes({
            a_position: this.positionBuffer,
            a_texCoord: this.texCoordBuffer
          });
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        });
      });
      return true;
    }
    return false;
  }
}
