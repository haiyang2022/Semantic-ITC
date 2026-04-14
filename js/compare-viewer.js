(function () {
    var EDL_ENABLED = true;
    var EDL_STRENGTH = 1.35;
    var EDL_RADIUS_PX = 1.35;

    var LEFT_FILE = "./data/merged_voxel0.05_xyzi.asc";
    var RIGHT_FILE = "./data/merged_voxel0.05_xyzrgb.asc";
    var MAX_POINTS = 1200000;
    var FIXED_POINT_SIZE = 2.0;

    function clamp01(v) {
        return Math.min(Math.max(v, 0), 1);
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function intensityToColor(t) {
        var stops = [
            [0.0, [0.231, 0.298, 0.753]],
            [0.25, [0.266, 0.690, 0.984]],
            [0.5, [0.865, 0.865, 0.865]],
            [0.75, [0.984, 0.561, 0.266]],
            [1.0, [0.706, 0.016, 0.149]]
        ];

        t = clamp01(t);
        for (var i = 0; i < stops.length - 1; i++) {
            var a = stops[i];
            var b = stops[i + 1];
            if (t >= a[0] && t <= b[0]) {
                var local = (t - a[0]) / Math.max(b[0] - a[0], 1e-8);
                return [
                    lerp(a[1][0], b[1][0], local),
                    lerp(a[1][1], b[1][1], local),
                    lerp(a[1][2], b[1][2], local)
                ];
            }
        }
        return stops[stops.length - 1][1];
    }

    function normalizeAndCenterByBBox(positions) {
        var minX = Infinity;
        var minY = Infinity;
        var minZ = Infinity;
        var maxX = -Infinity;
        var maxY = -Infinity;
        var maxZ = -Infinity;
        var i;

        for (i = 0; i < positions.length; i += 3) {
            var ox = positions[i];
            var oy = positions[i + 1];
            var oz = positions[i + 2];
            if (ox < minX) { minX = ox; }
            if (oy < minY) { minY = oy; }
            if (oz < minZ) { minZ = oz; }
            if (ox > maxX) { maxX = ox; }
            if (oy > maxY) { maxY = oy; }
            if (oz > maxZ) { maxZ = oz; }
        }

        var centerX = (minX + maxX) * 0.5;
        var centerY = (minY + maxY) * 0.5;
        var centerZ = (minZ + maxZ) * 0.5;
        var spanX = maxX - minX;
        var spanY = maxY - minY;
        var spanZ = maxZ - minZ;
        var maxSpan = Math.max(spanX, spanY, spanZ, 1e-6);
        var scale = 2.0 / maxSpan;

        minX = Infinity;
        minY = Infinity;
        minZ = Infinity;
        maxX = -Infinity;
        maxY = -Infinity;
        maxZ = -Infinity;

        for (i = 0; i < positions.length; i += 3) {
            var x = (positions[i] - centerX) * scale;
            var y = (positions[i + 1] - centerY) * scale;
            var z = (positions[i + 2] - centerZ) * scale;
            positions[i] = x;
            positions[i + 1] = y;
            positions[i + 2] = z;

            if (x < minX) { minX = x; }
            if (y < minY) { minY = y; }
            if (z < minZ) { minZ = z; }
            if (x > maxX) { maxX = x; }
            if (y > maxY) { maxY = y; }
            if (z > maxZ) { maxZ = z; }
        }

        var center2X = (minX + maxX) * 0.5;
        var center2Y = (minY + maxY) * 0.5;
        var center2Z = (minZ + maxZ) * 0.5;
        var radius = 0;
        for (i = 0; i < positions.length; i += 3) {
            positions[i] -= center2X;
            positions[i + 1] -= center2Y;
            positions[i + 2] -= center2Z;
            var rr = Math.sqrt(
                positions[i] * positions[i] +
                positions[i + 1] * positions[i + 1] +
                positions[i + 2] * positions[i + 2]
            );
            if (rr > radius) {
                radius = rr;
            }
        }

        var sx = (maxX - minX);
        var sy = (maxY - minY);
        var sz = (maxZ - minZ);
        return {
            halfX: Math.max(sx * 0.5, 1e-4),
            halfY: Math.max(sy * 0.5, 1e-4),
            halfZ: Math.max(sz * 0.5, 1e-4),
            boundingRadius: Math.max(radius, 1e-4)
        };
    }

    function parseXYZRGB(rawText, maxPoints) {
        var lines = rawText.split(/\r?\n/);
        var step = Math.max(1, Math.floor(lines.length / maxPoints));
        var positions = [];
        var colors = [];

        for (var i = 0; i < lines.length; i += step) {
            var line = lines[i].trim();
            if (line.length === 0) {
                continue;
            }

            var values = line.split(/\s+/);
            if (values.length < 6) {
                continue;
            }

            var x = Number(values[0]);
            var y = Number(values[1]);
            var z = Number(values[2]);
            var r = Number(values[3]);
            var g = Number(values[4]);
            var b = Number(values[5]);

            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
                continue;
            }
            if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
                continue;
            }

            positions.push(x, y, z);

            var colorScale = (r > 1 || g > 1 || b > 1) ? 255 : 1;
            colors.push(clamp01(r / colorScale), clamp01(g / colorScale), clamp01(b / colorScale));
        }

        var positionsArray = new Float32Array(positions);
        var metrics = normalizeAndCenterByBBox(positionsArray);

        return {
            positions: positionsArray,
            colors: new Float32Array(colors),
            metrics: metrics,
            count: positionsArray.length / 3
        };
    }

    function parseXYZI(rawText, maxPoints) {
        var lines = rawText.split(/\r?\n/);
        var step = Math.max(1, Math.floor(lines.length / maxPoints));
        var positions = [];
        var intensities = [];
        var minI = Infinity;
        var maxI = -Infinity;

        for (var i = 0; i < lines.length; i += step) {
            var line = lines[i].trim();
            if (line.length === 0) {
                continue;
            }

            var values = line.split(/\s+/);
            if (values.length < 4) {
                continue;
            }

            var x = Number(values[0]);
            var y = Number(values[1]);
            var z = Number(values[2]);
            var intensity = Number(values[3]);

            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(intensity)) {
                continue;
            }

            positions.push(x, y, z);
            intensities.push(intensity);
            if (intensity < minI) { minI = intensity; }
            if (intensity > maxI) { maxI = intensity; }
        }

        var positionsArray = new Float32Array(positions);
        var metrics = normalizeAndCenterByBBox(positionsArray);
        var colors = new Float32Array(intensities.length * 3);
        var range = Math.max(maxI - minI, 1e-8);

        for (var c = 0; c < intensities.length; c++) {
            var t = (intensities[c] - minI) / range;
            var color = intensityToColor(t);
            var idx = c * 3;
            colors[idx] = color[0];
            colors[idx + 1] = color[1];
            colors[idx + 2] = color[2];
        }

        return {
            positions: positionsArray,
            colors: colors,
            metrics: metrics,
            count: positionsArray.length / 3
        };
    }

    function makeEDLPack() {
        return {
            target: null,
            scene: null,
            camera: null,
            material: null,
            enabled: false
        };
    }

    function CompareViewer() {
        this.container = document.getElementById("pc-compare-canvas");
        this.leftStatus = document.getElementById("pc-left-status");
        this.rightStatus = document.getElementById("pc-right-status");

        this.sceneLeft = new THREE.Scene();
        this.sceneRight = new THREE.Scene();
        this.groupLeft = new THREE.Group();
        this.groupRight = new THREE.Group();
        this.sceneLeft.add(this.groupLeft);
        this.sceneRight.add(this.groupRight);
        this.sceneLeft.add(new THREE.AmbientLight(0xffffff, 1.0));
        this.sceneRight.add(new THREE.AmbientLight(0xffffff, 1.0));

        this.camera = new THREE.PerspectiveCamera(48, 1, 0.01, 100);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x000000, 0);
        if ("outputColorSpace" in this.renderer && THREE.SRGBColorSpace) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        } else if ("outputEncoding" in this.renderer && THREE.sRGBEncoding) {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.addEventListener("change", this.render.bind(this));

        this.leftPoints = null;
        this.rightPoints = null;
        this.leftMetrics = null;
        this.rightMetrics = null;

        this.edlLeft = makeEDLPack();
        this.edlRight = makeEDLPack();
    }

    CompareViewer.prototype.setStatus = function (side, text) {
        if (side === "left") {
            this.leftStatus.textContent = text;
        } else {
            this.rightStatus.textContent = text;
        }
    };

    CompareViewer.prototype.initEDLFor = function (pack) {
        if (!EDL_ENABLED || !THREE.DepthTexture) {
            return;
        }

        try {
            pack.target = new THREE.WebGLRenderTarget(1, 1, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                depthBuffer: true,
                stencilBuffer: false
            });
            pack.target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedShortType);

            pack.scene = new THREE.Scene();
            pack.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
            pack.material = new THREE.ShaderMaterial({
                uniforms: {
                    tColor: { value: null },
                    tDepth: { value: null },
                    resolution: { value: new THREE.Vector2(1, 1) },
                    cameraNear: { value: this.camera.near },
                    cameraFar: { value: this.camera.far },
                    radiusPx: { value: EDL_RADIUS_PX },
                    strength: { value: EDL_STRENGTH }
                },
                vertexShader: [
                    "varying vec2 vUv;",
                    "void main(){",
                    "  vUv = uv;",
                    "  gl_Position = vec4(position.xy, 0.0, 1.0);",
                    "}"
                ].join("\n"),
                fragmentShader: [
                    "precision highp float;",
                    "varying vec2 vUv;",
                    "uniform sampler2D tColor;",
                    "uniform sampler2D tDepth;",
                    "uniform vec2 resolution;",
                    "uniform float cameraNear;",
                    "uniform float cameraFar;",
                    "uniform float radiusPx;",
                    "uniform float strength;",
                    "float linearDepth(float d){",
                    "  float z = d * 2.0 - 1.0;",
                    "  return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear));",
                    "}",
                    "void main(){",
                    "  vec4 base = texture2D(tColor, vUv);",
                    "  float d0Raw = texture2D(tDepth, vUv).r;",
                    "  if (d0Raw >= 0.99999) { gl_FragColor = base; return; }",
                    "  float d0 = linearDepth(d0Raw);",
                    "  vec2 texel = vec2(1.0) / resolution;",
                    "  vec2 offs[8];",
                    "  offs[0] = vec2( 1.0, 0.0); offs[1] = vec2(-1.0, 0.0);",
                    "  offs[2] = vec2( 0.0, 1.0); offs[3] = vec2( 0.0,-1.0);",
                    "  offs[4] = vec2( 1.0, 1.0); offs[5] = vec2(-1.0, 1.0);",
                    "  offs[6] = vec2( 1.0,-1.0); offs[7] = vec2(-1.0,-1.0);",
                    "  float accum = 0.0;",
                    "  for (int i = 0; i < 8; i++) {",
                    "    vec2 suv = vUv + offs[i] * texel * radiusPx;",
                    "    float dnRaw = texture2D(tDepth, suv).r;",
                    "    if (dnRaw >= 0.99999) { continue; }",
                    "    float dn = linearDepth(dnRaw);",
                    "    accum += max(0.0, (dn - d0) / max(d0, 1e-4));",
                    "  }",
                    "  float shade = exp(-strength * accum * 2.25);",
                    "  gl_FragColor = vec4(base.rgb * shade, base.a);",
                    "}"
                ].join("\n"),
                depthWrite: false,
                depthTest: false,
                transparent: false
            });

            pack.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), pack.material));
            pack.enabled = true;
        } catch (err) {
            pack.enabled = false;
        }
    };

    CompareViewer.prototype.init = function () {
        if (!this.container || !this.leftStatus || !this.rightStatus) {
            return false;
        }

        this.container.appendChild(this.renderer.domElement);
        this.initEDLFor(this.edlLeft);
        this.initEDLFor(this.edlRight);
        this.resize();
        return true;
    };

    CompareViewer.prototype.fitCamera = function () {
        if (!this.leftMetrics || !this.rightMetrics) {
            return;
        }

        var halfX = Math.max(this.leftMetrics.halfX, this.rightMetrics.halfX);
        var halfY = Math.max(this.leftMetrics.halfY, this.rightMetrics.halfY);
        var halfZ = Math.max(this.leftMetrics.halfZ, this.rightMetrics.halfZ);
        var radius = Math.max(this.leftMetrics.boundingRadius, this.rightMetrics.boundingRadius);

        var fovV = this.camera.fov * Math.PI / 180;
        var halfAspect = this.camera.aspect * 0.5;
        var fovH = 2 * Math.atan(Math.tan(fovV * 0.5) * Math.max(halfAspect, 1e-4));

        var distV = halfY / Math.tan(fovV * 0.5);
        var distH = halfX / Math.tan(fovH * 0.5);
        var fitDistance = Math.max(distV, distH, halfZ) * 1.45 + 0.08;

        this.camera.position.set(0, 0, fitDistance);
        this.camera.near = Math.max(0.01, fitDistance - radius * 3.0);
        this.camera.far = fitDistance + radius * 3.0;
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();

        this.controls.target.set(0, 0, 0);
        this.controls.update();

        if (this.edlLeft.enabled) {
            this.edlLeft.material.uniforms.cameraNear.value = this.camera.near;
            this.edlLeft.material.uniforms.cameraFar.value = this.camera.far;
        }
        if (this.edlRight.enabled) {
            this.edlRight.material.uniforms.cameraNear.value = this.camera.near;
            this.edlRight.material.uniforms.cameraFar.value = this.camera.far;
        }
    };

    CompareViewer.prototype.resize = function () {
        var width = Math.max(this.container.clientWidth, 1);
        var height = Math.max(this.container.clientHeight, 1);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, true);

        var pr = this.renderer.getPixelRatio();
        var halfW = Math.max(1, Math.floor(width * pr * 0.5));
        var fullH = Math.max(1, Math.floor(height * pr));

        [this.edlLeft, this.edlRight].forEach(function (pack) {
            if (!pack.enabled) {
                return;
            }
            pack.target.setSize(halfW, fullH);
            pack.target.depthTexture.image.width = halfW;
            pack.target.depthTexture.image.height = fullH;
            pack.material.uniforms.resolution.value.set(halfW, fullH);
        });

        this.fitCamera();
        this.render();
    };

    CompareViewer.prototype.createPoints = function (data) {
        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
        var material = new THREE.PointsMaterial({
            size: FIXED_POINT_SIZE,
            sizeAttenuation: false,
            vertexColors: true,
            opacity: 1,
            transparent: false,
            depthWrite: true,
            depthTest: true
        });
        return new THREE.Points(geometry, material);
    };

    CompareViewer.prototype.load = async function () {
        this.setStatus("left", "Loading merged_voxel0.05_xyzi.asc...");
        this.setStatus("right", "Loading merged_voxel0.05_xyzrgb.asc...");

        var leftResp = await fetch(LEFT_FILE, { cache: "no-store" });
        var rightResp = await fetch(RIGHT_FILE, { cache: "no-store" });
        if (!leftResp.ok || !rightResp.ok) {
            throw new Error("Failed to fetch compare point clouds.");
        }

        var leftText = await leftResp.text();
        var rightText = await rightResp.text();

        var leftData = parseXYZI(leftText, MAX_POINTS);
        var rightData = parseXYZRGB(rightText, MAX_POINTS);

        if (this.leftPoints !== null) {
            this.leftPoints.geometry.dispose();
            this.leftPoints.material.dispose();
            this.groupLeft.remove(this.leftPoints);
        }
        if (this.rightPoints !== null) {
            this.rightPoints.geometry.dispose();
            this.rightPoints.material.dispose();
            this.groupRight.remove(this.rightPoints);
        }

        this.leftPoints = this.createPoints(leftData);
        this.rightPoints = this.createPoints(rightData);
        this.groupLeft.add(this.leftPoints);
        this.groupRight.add(this.rightPoints);

        this.leftMetrics = leftData.metrics;
        this.rightMetrics = rightData.metrics;

        this.fitCamera();
        this.setStatus("left", leftData.count.toLocaleString() + " points");
        this.setStatus("right", rightData.count.toLocaleString() + " points");
        this.render();
    };

    CompareViewer.prototype.renderPacked = function (scene, pack, x, y, w, h) {
        if (!pack.enabled) {
            this.renderer.setViewport(x, y, w, h);
            this.renderer.setScissor(x, y, w, h);
            this.renderer.setScissorTest(true);
            this.renderer.render(scene, this.camera);
            return;
        }

        this.renderer.setRenderTarget(pack.target);
        this.renderer.clear();
        this.renderer.render(scene, this.camera);
        this.renderer.setRenderTarget(null);

        pack.material.uniforms.tColor.value = pack.target.texture;
        pack.material.uniforms.tDepth.value = pack.target.depthTexture;

        this.renderer.setViewport(x, y, w, h);
        this.renderer.setScissor(x, y, w, h);
        this.renderer.setScissorTest(true);
        this.renderer.render(pack.scene, pack.camera);
    };

    CompareViewer.prototype.render = function () {
        var size = this.renderer.getSize(new THREE.Vector2());
        var w = size.x;
        var h = size.y;
        var halfW = Math.floor(w / 2);

        this.renderer.setScissorTest(true);
        this.renderer.setClearColor(0xffffff, 1.0);

        this.renderPacked(this.sceneLeft, this.edlLeft, 0, 0, halfW, h);
        this.renderPacked(this.sceneRight, this.edlRight, halfW, 0, w - halfW, h);

        this.renderer.setScissorTest(false);
    };

    function initCompare() {
        if (typeof THREE === "undefined" || typeof THREE.OrbitControls === "undefined") {
            return;
        }

        var viewer = new CompareViewer();
        if (!viewer.init()) {
            return;
        }

        window.addEventListener("resize", function () {
            viewer.resize();
        });

        viewer.load().catch(function (err) {
            viewer.setStatus("left", "Failed to load XYZI point cloud");
            viewer.setStatus("right", "Failed to load XYZRGB point cloud");
            console.error(err);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initCompare);
    } else {
        initCompare();
    }
})();
