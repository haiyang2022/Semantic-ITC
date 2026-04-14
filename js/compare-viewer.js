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
            depthScale: Math.max(sx, sy, sz, 1e-4),
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
            colors.push(
                clamp01(r / colorScale),
                clamp01(g / colorScale),
                clamp01(b / colorScale)
            );
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

    function ViewerManager() {
        this.viewers = [];
        this.syncing = false;
    }

    ViewerManager.prototype.addViewer = function (viewer) {
        this.viewers.push(viewer);
    };

    ViewerManager.prototype.synchronizeControls = function (activeViewer) {
        if (this.syncing) {
            return;
        }
        this.syncing = true;

        var camera = activeViewer.camera;
        var controls = activeViewer.controls;

        this.viewers.forEach(function (viewer) {
            if (viewer !== activeViewer) {
                viewer.camera.position.copy(camera.position);
                viewer.camera.rotation.copy(camera.rotation);
                viewer.controls.target.copy(controls.target);
                viewer.controls.update();
            }
            viewer.render();
        });

        this.syncing = false;
    };

    function SceneViewer(containerId, statusId, filePath, mode, manager) {
        this.container = document.getElementById(containerId);
        this.statusEl = document.getElementById(statusId);
        this.filePath = filePath;
        this.mode = mode;
        this.manager = manager;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(48, 1, 0.01, 100);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

        this.group = new THREE.Group();
        this.pointCloud = null;
        this.fitMetrics = null;

        this.useEDL = false;
        this.edlTarget = null;
        this.edlScene = null;
        this.edlCamera = null;
        this.edlMaterial = null;

        this.init();
    }

    SceneViewer.prototype.setStatus = function (msg) {
        this.statusEl.textContent = msg;
    };

    SceneViewer.prototype.init = function () {
        if (this.container === null || this.statusEl === null) {
            return;
        }

        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x000000, 0);
        if ("outputColorSpace" in this.renderer && THREE.SRGBColorSpace) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        } else if ("outputEncoding" in this.renderer && THREE.sRGBEncoding) {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }
        this.container.appendChild(this.renderer.domElement);

        this.scene.add(this.group);
        this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.addEventListener("change", this.onControlsChanged.bind(this));

        this.initEDL();
        this.resize();
    };

    SceneViewer.prototype.initEDL = function () {
        if (!EDL_ENABLED || !THREE.DepthTexture) {
            return;
        }

        try {
            this.edlTarget = new THREE.WebGLRenderTarget(1, 1, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                depthBuffer: true,
                stencilBuffer: false
            });
            this.edlTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedShortType);

            this.edlScene = new THREE.Scene();
            this.edlCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
            this.edlMaterial = new THREE.ShaderMaterial({
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

            var edlQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.edlMaterial);
            this.edlScene.add(edlQuad);
            this.useEDL = true;
        } catch (error) {
            this.useEDL = false;
            console.warn("EDL init failed, fallback to standard rendering.", error);
        }
    };

    SceneViewer.prototype.fitCameraToScene = function () {
        if (this.fitMetrics === null) {
            return;
        }

        var halfX = this.fitMetrics.halfX;
        var halfY = this.fitMetrics.halfY;
        var halfZ = this.fitMetrics.halfZ;
        var radius = this.fitMetrics.boundingRadius;

        var fovV = this.camera.fov * Math.PI / 180;
        var fovH = 2 * Math.atan(Math.tan(fovV * 0.5) * this.camera.aspect);

        var distV = halfY / Math.tan(fovV * 0.5);
        var distH = halfX / Math.tan(fovH * 0.5);
        var fitDistance = Math.max(distV, distH, halfZ) * 1.45 + 0.08;

        this.camera.position.set(0, 0, fitDistance);
        this.camera.near = Math.max(0.01, fitDistance - radius * 3.0);
        this.camera.far = fitDistance + radius * 3.0;
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();

        if (this.useEDL && this.edlMaterial !== null) {
            this.edlMaterial.uniforms.cameraNear.value = this.camera.near;
            this.edlMaterial.uniforms.cameraFar.value = this.camera.far;
        }

        this.controls.target.set(0, 0, 0);
        this.controls.update();
    };

    SceneViewer.prototype.resize = function () {
        var width = Math.max(this.container.clientWidth, 1);
        var height = Math.max(this.container.clientHeight, 1);

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, true);

        if (this.useEDL && this.edlTarget !== null && this.edlMaterial !== null) {
            var pr = this.renderer.getPixelRatio();
            var rw = Math.max(1, Math.floor(width * pr));
            var rh = Math.max(1, Math.floor(height * pr));
            this.edlTarget.setSize(rw, rh);
            this.edlTarget.depthTexture.image.width = rw;
            this.edlTarget.depthTexture.image.height = rh;
            this.edlMaterial.uniforms.resolution.value.set(rw, rh);
        }

        this.fitCameraToScene();
        this.render();
    };

    SceneViewer.prototype.onControlsChanged = function () {
        this.manager.synchronizeControls(this);
        this.render();
    };

    SceneViewer.prototype.setPointCloud = function (pointData) {
        if (this.pointCloud !== null) {
            this.pointCloud.geometry.dispose();
            this.pointCloud.material.dispose();
            this.group.remove(this.pointCloud);
        }

        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(pointData.positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(pointData.colors, 3));

        var material = new THREE.PointsMaterial({
            size: FIXED_POINT_SIZE,
            sizeAttenuation: false,
            vertexColors: true,
            opacity: 1,
            transparent: false,
            depthWrite: true,
            depthTest: true
        });

        this.pointCloud = new THREE.Points(geometry, material);
        this.group.add(this.pointCloud);

        this.fitMetrics = pointData.metrics;
        this.fitCameraToScene();
        this.render();
    };

    SceneViewer.prototype.render = function () {
        if (this.useEDL && this.edlTarget !== null && this.edlMaterial !== null) {
            this.renderer.setRenderTarget(this.edlTarget);
            this.renderer.clear();
            this.renderer.render(this.scene, this.camera);
            this.renderer.setRenderTarget(null);

            this.edlMaterial.uniforms.tColor.value = this.edlTarget.texture;
            this.edlMaterial.uniforms.tDepth.value = this.edlTarget.depthTexture;
            this.renderer.render(this.edlScene, this.edlCamera);
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    };

    SceneViewer.prototype.loadPointCloud = async function () {
        try {
            var basename = this.filePath.split("/").pop() || this.filePath;
            this.setStatus("Loading " + basename + "...");

            var response = await fetch(this.filePath, { cache: "no-store" });
            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }

            var text = await response.text();
            var parsed = this.mode === "xyzi" ? parseXYZI(text, MAX_POINTS) : parseXYZRGB(text, MAX_POINTS);
            if (parsed.positions.length === 0) {
                throw new Error("No valid points parsed from file.");
            }

            this.setPointCloud(parsed);
            this.setStatus(parsed.count.toLocaleString() + " points" + (this.useEDL ? " · EDL" : "") + " · point size 2");
        } catch (error) {
            this.setStatus("Failed to load " + this.filePath);
            console.error(error);
        }
    };

    function initCompare() {
        if (typeof THREE === "undefined" || typeof THREE.OrbitControls === "undefined") {
            return;
        }

        if (!document.getElementById("pc-left") || !document.getElementById("pc-right")) {
            return;
        }

        var manager = new ViewerManager();

        var leftViewer = new SceneViewer("pc-left", "pc-left-status", LEFT_FILE, "xyzi", manager);
        var rightViewer = new SceneViewer("pc-right", "pc-right-status", RIGHT_FILE, "xyzrgb", manager);

        manager.addViewer(leftViewer);
        manager.addViewer(rightViewer);

        window.addEventListener("resize", function () {
            leftViewer.resize();
            rightViewer.resize();
        });

        Promise.all([leftViewer.loadPointCloud(), rightViewer.loadPointCloud()]).then(function () {
            manager.synchronizeControls(leftViewer);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initCompare);
    } else {
        initCompare();
    }
})();
