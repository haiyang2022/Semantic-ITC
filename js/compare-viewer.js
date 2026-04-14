(function () {
    var EDL_ENABLED = true;
    var EDL_STRENGTH = 1.35;
    var EDL_RADIUS_PX = 1.35;
    var MAX_POINTS = 1200000;
    var POINT_SIZE = 2.0;

    var MODELS = [
        { key: "region2-1", label: "Learning Area", path: "./data/learning_area.asc" },
        { key: "region1-1", label: "Corridor Area", path: "./data/corridor_area.asc" },
        { key: "baseline", label: "Classroom", path: "./data/classroom.asc" },
        { key: "1310", label: "Meeting Room", path: "./data/meeting_room.asc" },
        { key: "2104", label: "Office", path: "./data/office.asc" }
    ];

    function clamp01(v) {
        return Math.min(Math.max(v, 0), 1);
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

    function Viewer() {
        this.container = document.getElementById("pc-compare-canvas");
        this.status = document.getElementById("pc-view-status");
        this.title = document.getElementById("pc-current-title");
        this.selector = document.getElementById("pc-model-selector");

        this.scene = new THREE.Scene();
        this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));

        this.camera = new THREE.PerspectiveCamera(48, 1, 0.01, 100);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x000000, 0);

        if ("outputColorSpace" in this.renderer && THREE.SRGBColorSpace) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        } else if ("outputEncoding" in this.renderer && THREE.sRGBEncoding) {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }

        this.controls = null;
        this.points = null;
        this.fitMetrics = null;

        this.useEDL = false;
        this.edlTarget = null;
        this.edlScene = null;
        this.edlCamera = null;
        this.edlMaterial = null;

        this.currentModel = MODELS[0];
    }

    Viewer.prototype.initEDL = function () {
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

            this.edlScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.edlMaterial));
            this.useEDL = true;
        } catch (error) {
            this.useEDL = false;
        }
    };

    Viewer.prototype.fitCamera = function () {
        if (this.fitMetrics === null) {
            return;
        }

        var halfX = this.fitMetrics.halfX;
        var halfY = this.fitMetrics.halfY;
        var halfZ = this.fitMetrics.halfZ;
        var radius = this.fitMetrics.boundingRadius;

        var fovV = this.camera.fov * Math.PI / 180;
        var fovH = 2 * Math.atan(Math.tan(fovV * 0.5) * Math.max(this.camera.aspect, 1e-4));

        var preset = {
            distanceScale: 1.55,
            offset: new THREE.Vector3(0.42, 0.62, 1.0)
        };

        if (this.currentModel && this.currentModel.key === "baseline") {
            preset.distanceScale = 2.35;
            preset.offset.set(0.42, 0.62, 1.0);
        }

        if (this.currentModel && this.currentModel.key === "region2-1") {
            preset.distanceScale = 2.1;
            preset.offset.set(0.42, 0.62, -1.0);
        }

        if (this.currentModel && (this.currentModel.key === "1310" || this.currentModel.key === "2104")) {
            preset.distanceScale = 2.6;
        }

        var distV = halfY / Math.tan(fovV * 0.5);
        var distH = halfX / Math.tan(fovH * 0.5);
        var fitDistance = Math.max(distV, distH, halfZ) * preset.distanceScale + 0.08;

        var dir = preset.offset.clone().normalize();
        this.camera.position.set(dir.x * fitDistance, dir.y * fitDistance, dir.z * fitDistance);
        this.camera.near = Math.max(0.01, fitDistance - radius * 3.0);
        this.camera.far = fitDistance + radius * 3.0;
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();

        this.controls.target.set(0, 0, 0);
        this.controls.update();

        if (this.useEDL && this.edlMaterial !== null) {
            this.edlMaterial.uniforms.cameraNear.value = this.camera.near;
            this.edlMaterial.uniforms.cameraFar.value = this.camera.far;
        }
    };

    Viewer.prototype.resize = function () {
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

        this.fitCamera();
        this.render();
    };

    Viewer.prototype.render = function () {
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

    Viewer.prototype.loadModel = async function (model) {
        this.currentModel = model;
        this.title.textContent = model.label;
        this.status.textContent = "Loading " + model.label + "...";

        var response = await fetch(model.path, { cache: "no-store" });
        if (!response.ok) {
            throw new Error("HTTP " + response.status + " loading " + model.path);
        }

        var text = await response.text();
        var parsed = parseXYZRGB(text, MAX_POINTS);
        if (parsed.positions.length === 0) {
            throw new Error("No valid points in " + model.path);
        }

        if (this.points !== null) {
            this.points.geometry.dispose();
            this.points.material.dispose();
            this.scene.remove(this.points);
        }

        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(parsed.positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(parsed.colors, 3));

        var material = new THREE.PointsMaterial({
            size: POINT_SIZE,
            sizeAttenuation: false,
            vertexColors: true,
            opacity: 1,
            transparent: false,
            depthWrite: true,
            depthTest: true
        });

        this.points = new THREE.Points(geometry, material);
        this.scene.add(this.points);

        this.fitMetrics = parsed.metrics;
        this.fitCamera();
        this.status.textContent = parsed.count.toLocaleString() + " points";
        this.render();
    };

    Viewer.prototype.bindSelector = function () {
        var self = this;
        var buttons = this.selector.querySelectorAll(".pc-model-btn");

        buttons.forEach(function (btn) {
            btn.addEventListener("click", function () {
                var key = btn.getAttribute("data-model");
                var target = null;
                for (var i = 0; i < MODELS.length; i++) {
                    if (MODELS[i].key === key) {
                        target = MODELS[i];
                        break;
                    }
                }
                if (target === null) {
                    return;
                }

                buttons.forEach(function (b) { b.classList.remove("active"); });
                btn.classList.add("active");

                self.loadModel(target).catch(function (err) {
                    self.status.textContent = "Failed to load " + target.label;
                    console.error(err);
                });
            });
        });
    };

    Viewer.prototype.bindControls = function () {
        var self = this;
        var zoomIn = document.getElementById("pc-zoom-in");
        var zoomOut = document.getElementById("pc-zoom-out");
        var reset = document.getElementById("pc-reset");

        if (zoomIn) {
            zoomIn.addEventListener("click", function () {
                self.renderer.domElement.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
            });
        }
        if (zoomOut) {
            zoomOut.addEventListener("click", function () {
                self.renderer.domElement.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
            });
        }
        if (reset) {
            reset.addEventListener("click", function () {
                self.fitCamera();
                self.render();
            });
        }
    };

    function initCompare() {
        if (typeof THREE === "undefined" || typeof THREE.OrbitControls === "undefined") {
            return;
        }

        var viewer = new Viewer();
        if (!viewer.container || !viewer.status || !viewer.title || !viewer.selector) {
            return;
        }

        viewer.container.appendChild(viewer.renderer.domElement);
        viewer.controls = new THREE.OrbitControls(viewer.camera, viewer.renderer.domElement);
        viewer.controls.addEventListener("change", function () { viewer.render(); });

        viewer.initEDL();
        viewer.resize();
        viewer.bindSelector();
        viewer.bindControls();

        window.addEventListener("resize", function () {
            viewer.resize();
        });

        viewer.loadModel(MODELS[0]).catch(function (err) {
            viewer.status.textContent = "Failed to load " + MODELS[0].label;
            console.error(err);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initCompare);
    } else {
        initCompare();
    }
})();
