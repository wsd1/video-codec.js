// TODO: 行列演算の箇所を整理し，外部ライブラリに依存しないようにする

declare function $M(v:any):any;
declare function $V(v:any):any;
declare var Matrix: any;

interface IRenderer {
    init(canvas: HTMLCanvasElement, width: number, height: number): void;
    render(y: Uint8Array, u: Uint8Array, v: Uint8Array): void;
    is_rgba(): boolean;
}

class Texture {
    gl: WebGLRenderingContext;
    width: number;
    height: number;
    format: number;
    texture: WebGLTexture;
    
    constructor(gl: WebGLRenderingContext, width: number, height: number) {
        this.gl = gl;
        this.width = width;
        this.height = height;
        this.format = gl.LUMINANCE;
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, this.format, width, height, 0, this.format, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    bind(n: number, program: WebGLProgram, name: string): void {
        var gl = this.gl;
        gl.activeTexture([gl.TEXTURE0, gl.TEXTURE1, gl.TEXTURE2][n]);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(gl.getUniformLocation(program, name), n);
    }

    fill(data: Uint8Array) : void {
        var gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, this.format, this.width, this.height, 0, this.format,
                      gl.UNSIGNED_BYTE, data);
    }
}

class WebGLRenderer implements IRenderer {
    gl: WebGLRenderingContext;
    y: Texture;
    u: Texture;
    v: Texture;
    
    init(canvas: HTMLCanvasElement, width: number, height: number): void {
        this.gl = <WebGLRenderingContext>canvas.getContext("webgl");
        var gl = this.gl;

        var f_shader = gl.createShader(gl.FRAGMENT_SHADER);
        var f_shader_src = ["precision highp float;",
                            "varying highp vec2 vTextureCoord;",
                            "uniform sampler2D YTexture;",
                            "uniform sampler2D UTexture;",
                            "uniform sampler2D VTexture;",
                            "const mat4 YUV2RGB = mat4",
                            "(",
                            " 1.1643828125, 0, 1.59602734375, -.87078515625,",
                            " 1.1643828125, -.39176171875, -.81296875, .52959375,",
                            " 1.1643828125, 2.017234375, 0, -1.081390625,",
                            " 0, 0, 0, 1",
                            ");",
                            "void main(void) {",
                            " gl_FragColor = vec4( texture2D(YTexture, vTextureCoord).x, texture2D(UTexture, vTextureCoord).x, texture2D(VTexture, vTextureCoord).x, 1) * YUV2RGB;",
                            "}"].join("\n");
        gl.shaderSource(f_shader, f_shader_src);
        gl.compileShader(f_shader);

        var v_shader = gl.createShader(gl.VERTEX_SHADER);
        var v_shader_src = ["attribute vec3 aVertexPosition;",
                            "attribute vec2 aTextureCoord;",
                            "uniform mat4 uMVMatrix;",
                            "uniform mat4 uPMatrix;",
                            "varying highp vec2 vTextureCoord;",
                            "void main(void) {",
                            " gl_Position = uPMatrix * uMVMatrix * vec4(aVertexPosition, 1.0);",
                            " vTextureCoord = aTextureCoord;",
                            "}"].join("\n");
        gl.shaderSource(v_shader, v_shader_src);
        gl.compileShader(v_shader);

        var program = gl.createProgram();
        gl.attachShader(program, f_shader);
        gl.attachShader(program, v_shader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.log("Unable to initialize the shader program.");
            return;
        }
        gl.useProgram(program);
        var vertexPositionAttribute = gl.getAttribLocation(program, "aVertexPosition");
        gl.enableVertexAttribArray(vertexPositionAttribute);
        var textureCoordAttribute = gl.getAttribLocation(program, "aTextureCoord");;
        gl.enableVertexAttribArray(textureCoordAttribute);

        var quadVPBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVPBuffer);
        var tmp = [ 1.0,  1.0, 0.0,
                   -1.0,  1.0, 0.0,
                    1.0, -1.0, 0.0,
                   -1.0, -1.0, 0.0];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tmp), gl.STATIC_DRAW);
        /*
          +--------------------+
          | -1,1 (1) | 1,1 (0)
          | |
          | |
          | |
          | |
          | |
          | -1,-1 (3) | 1,-1 (2)
          +--------------------+
        */
        var scaleX = 1.0;
        var scaleY = 1.0;
        var quadVTCBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVTCBuffer);
        tmp = [scaleX, 0.0,
               0.0, 0.0,
               scaleX, scaleY,
               0.0, scaleY];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tmp), gl.STATIC_DRAW);
        
        this.y = new Texture(this.gl, width, height);
        this.u = new Texture(this.gl, width >> 1, height >> 1);
        this.v = new Texture(this.gl, width >> 1, height >> 1);

        var perspectiveMatrix = this._makePerspective(45, 1, 0.1, 100.0);
        var mvMatrix = Matrix.I(4);
        mvMatrix = mvMatrix.x(this._ensure4x4(this._translation($V([0.0, 0.0, -2.4]))));
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVPBuffer);
        gl.vertexAttribPointer(vertexPositionAttribute, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVTCBuffer);
        gl.vertexAttribPointer(textureCoordAttribute, 2, gl.FLOAT, false, 0, 0);

        this.y.bind(0, program, "YTexture");
        this.u.bind(1, program, "UTexture");
        this.v.bind(2, program, "VTexture");

        var uniform = this.gl.getUniformLocation(program, "uPMatrix");
        this.gl.uniformMatrix4fv(uniform, false, new Float32Array(this._flatten(perspectiveMatrix)));
        uniform = this.gl.getUniformLocation(program, "uMVMatrix");
        this.gl.uniformMatrix4fv(uniform, false, new Float32Array(this._flatten(mvMatrix)));
    }

    _makePerspective(fovy: number, aspect: number, znear: number, zfar: number)
    {
        var ymax = znear * Math.tan(fovy * Math.PI / 360.0);
        var ymin = -ymax;
        var xmin = ymin * aspect;
        var xmax = ymax * aspect;
        return this._makeFrustum(xmin, xmax, ymin, ymax, znear, zfar);
    }

    _makeFrustum(left: number, right: number,
                 bottom: number, top: number,
                 znear: number, zfar: number)
    {
        var X = 2*znear/(right-left);
        var Y = 2*znear/(top-bottom);
        var A = (right+left)/(right-left);
        var B = (top+bottom)/(top-bottom);
        var C = -(zfar+znear)/(zfar-znear);
        var D = -2*zfar*znear/(zfar-znear);
        return $M([[X, 0, A, 0],
                   [0, Y, B, 0],
                   [0, 0, C, D],
                   [0, 0, -1, 0]]);
    }

    _translation(v: any) {
        if (v.elements.length == 2) {
            var r = Matrix.I(3);
            r.elements[2][0] = v.elements[0];
            r.elements[2][1] = v.elements[1];
            return r;
        }
        if (v.elements.length == 3) {
            var r = Matrix.I(4);
            r.elements[0][3] = v.elements[0];
            r.elements[1][3] = v.elements[1];
            r.elements[2][3] = v.elements[2];
            return r;
        }
    }

    _ensure4x4(v: any) {
        if (v.elements.length == 4 &&
            v.elements[0].length == 4)
            return v;
        if (v.elements.length > 4 ||
            v.elements[0].length > 4)
            return null;
        for (var i = 0; i < v.elements.length; i++) {
            for (var j = v.elements[i].length; j < 4; j++) {
                if (i == j)
                    v.elements[i].push(1);
                else
                    v.elements[i].push(0);
            }
        }
        for (var i:number = v.elements.length; i < 4; i++) {
            if (i == 0)
                v.elements.push([1, 0, 0, 0]);
            else if (i == 1)
                v.elements.push([0, 1, 0, 0]);
            else if (i == 2)
                v.elements.push([0, 0, 1, 0]);
            else if (i == 3)
                v.elements.push([0, 0, 0, 1]);
        }
        return v;
    }

    _flatten(v: any) {
        var result = [];
        if (v.elements.length == 0)
            return [];
        for (var j = 0; j < v.elements[0].length; j++)
            for (var i = 0; i < v.elements.length; i++)
                result.push(v.elements[i][j]);
        return result;
    }
    
    render(y: Uint8Array, u: Uint8Array, v: Uint8Array) {
        this.y.fill(y);
        this.u.fill(u);
        this.v.fill(v);
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }

    is_rgba(): boolean {
        return false;
    }
}

class RGBRenderer {
    img: ImageData;
    ctx: CanvasRenderingContext2D;
    width: number;
    height: number;

    init(canvas: HTMLCanvasElement, width: number, height: number): void {
        this.width = width;
        this.height = height;
        this.ctx = canvas.getContext('2d');
        this.img = this.ctx.createImageData(width, height);
    }

    render(rgba: Uint8Array, dummy_arg0: Uint8Array, dummy_arg1: Uint8Array): void {
        //var x = <Uint8ClampedArray>this.img.data;
        var x = <any>this.img.data;
        new Uint8Array(x.buffer, x.byteOffset, x.byteLength).set(rgba);
        this.ctx.putImageData(this.img, 0, 0);
    }

    is_rgba(): boolean {
        return true;
    }

    yuv_to_rgba(y: Uint8Array, u: Uint8Array, v: Uint8Array, rgba: number[]) {
        for (var i = 0; i < this.height; ++i) {
            var q = (i * this.width)|0;
            var p = (q >> 2)|0;
            for (var j = 0; j < this.width; ++j) {
                var qj = (q + j)|0;
                var qj4 = (qj * 4)|0;
                var pj = (p + ((j >> 1)|0))|0;
                var x = (1.164 * (y[qj] - 16))|0;
                rgba[qj4 + 0] = (x + 1.596 * (v[pj] - 128))|0;
                rgba[qj4 + 1] = (x - 0.391 * (u[pj] - 128) - 0.813 * (v[pj] - 128))|0;
                rgba[qj4 + 2] = (x + 2.018 * (u[pj] - 128))|0;
                rgba[qj4 + 3] = 255;
            }
        }
    }
}