(function () {
    var CLASS_NAMES = [
        "beam", "board", "cabinetshelf", "ceiling", "chair",
        "column", "door", "floor", "light", "screen",
        "sofa", "stair", "table", "vegetation", "wall"
    ];

    var EDL_ENABLED = true;
    var EDL_STRENGTH = 1.35;
    var EDL_RADIUS_PX = 1.35;

    function slugify(name) {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }

    function createCard(name) {
        var card = document.createElement("article");
        card.className = "pc-card";

        var header = document.createElement("div");
        header.className = "pc-card-header";

        var title = document.createElement("h3");
        title.textContent = name;
        header.appendChild(title);

        var viewer = document.createElement("div");
        viewer.id = slugify(name) + "-pointcloud-viewer";
        viewer.className = "pc-viewer";

        var status = document.createElement("div");
        status.id = slugify(name) + "-pointcloud-status";
        status.className = "pc-status";
        status.textContent = "Loading " + name + " point cloud...";

        card.appendChild(header);
        card.appendChild(viewer);
        card.appendChild(status);

        return { card: card, viewer: viewer, status: status };
    }

    function createViewer(container, statusEl, filePath, className) {
        if (typeof THREE === "undefined") {
            statusEl.textContent = "Three.js failed to load. Check local js/three.min.js.";
            return;
        }

        var scene = new THREE.Scene();
        var camera = new THREE.PerspectiveCamera(48, 1, 0.01, 100);
        var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        var group = new THREE.Group();
        var pointCloud = null;
        var isVisible = true;
        var fitMetrics = null;
        var classKey = (className || "").toLowerCase();
        var fixedTiltX = 0;
        if (classKey === "floor" || classKey === "ceiling") {
            fixedTiltX = -0.72;
        } else if (classKey === "beam") {
            fixedTiltX = -0.28;
        }

        var useEDL = false;
        var edlTarget = null;
        var edlScene = null;
        var edlCamera = null;
        var edlMaterial = null;
        var edlQuad = null;

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
            renderer.outputColorSpace = THREE.SRGBColorSpace;
        } else if ("outputEncoding" in renderer && THREE.sRGBEncoding) {
            renderer.outputEncoding = THREE.sRGBEncoding;
        }
        container.appendChild(renderer.domElement);

        scene.add(group);
        scene.add(new THREE.AmbientLight(0xffffff, 1.0));

        function setStatus(message) {
            statusEl.textContent = message;
        }

        function initEDL() {
            if (!EDL_ENABLED || !THREE.DepthTexture) {
                return;
            }

            try {
                edlTarget = new THREE.WebGLRenderTarget(1, 1, {
                    minFilter: THREE.LinearFilter,
                    magFilter: THREE.LinearFilter,
                    format: THREE.RGBAFormat,
                    depthBuffer: true,
                    stencilBuffer: false
                });
                edlTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedShortType);

                edlScene = new THREE.Scene();
                edlCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
                edlMaterial = new THREE.ShaderMaterial({
                    uniforms: {
                        tColor: { value: null },
                        tDepth: { value: null },
                        resolution: { value: new THREE.Vector2(1, 1) },
                        cameraNear: { value: camera.near },
                        cameraFar: { value: camera.far },
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

                edlQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), edlMaterial);
                edlScene.add(edlQuad);
                useEDL = true;
            } catch (error) {
                useEDL = false;
                console.warn("EDL init failed, fallback to standard rendering.", error);
            }
        }

        function fitCameraToScene() {
            if (fitMetrics === null) {
                return;
            }

            var halfX = fitMetrics.halfX;
            var halfY = fitMetrics.halfY;
            var halfZ = fitMetrics.halfZ;
            var radius = fitMetrics.boundingRadius;

            var fovV = camera.fov * Math.PI / 180;
            var fovH = 2 * Math.atan(Math.tan(fovV * 0.5) * camera.aspect);

            var distV = halfY / Math.tan(fovV * 0.5);
            var distH = halfX / Math.tan(fovH * 0.5);
            var fitDistance = Math.max(distV, distH, halfZ) * 1.45 + 0.08;

            camera.position.set(0, 0, fitDistance);
            camera.near = Math.max(0.01, fitDistance - radius * 3.0);
            camera.far = fitDistance + radius * 3.0;
            camera.lookAt(0, 0, 0);
            camera.updateProjectionMatrix();

            if (useEDL && edlMaterial !== null) {
                edlMaterial.uniforms.cameraNear.value = camera.near;
                edlMaterial.uniforms.cameraFar.value = camera.far;
            }
        }

        function resize() {
            var width = Math.max(container.clientWidth, 1);
            var height = Math.max(container.clientHeight, 1);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height, true);

            if (useEDL && edlTarget !== null && edlMaterial !== null) {
                var pr = renderer.getPixelRatio();
                var rw = Math.max(1, Math.floor(width * pr));
                var rh = Math.max(1, Math.floor(height * pr));
                edlTarget.setSize(rw, rh);
                edlTarget.depthTexture.image.width = rw;
                edlTarget.depthTexture.image.height = rh;
                edlMaterial.uniforms.resolution.value.set(rw, rh);
            }

            fitCameraToScene();
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
                    Math.min(Math.max(r / colorScale, 0), 1),
                    Math.min(Math.max(g / colorScale, 0), 1),
                    Math.min(Math.max(b / colorScale, 0), 1)
                );
            }

            var positionsArray = new Float32Array(positions);
            var metrics = normalizeAndCenterByBBox(positionsArray);

            return {
                positions: positionsArray,
                colors: new Float32Array(colors),
                metrics: metrics
            };
        }

        function setPointCloud(pointData) {
            if (pointCloud !== null) {
                pointCloud.geometry.dispose();
                pointCloud.material.dispose();
                group.remove(pointCloud);
            }

            var geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.BufferAttribute(pointData.positions, 3));
            geometry.setAttribute("color", new THREE.BufferAttribute(pointData.colors, 3));

            var material = new THREE.PointsMaterial({
                size: Math.max(0.0035, pointData.metrics.depthScale * 0.0018),
                sizeAttenuation: true,
                vertexColors: true,
                opacity: 1,
                transparent: false,
                depthWrite: true,
                depthTest: true
            });

            pointCloud = new THREE.Points(geometry, material);
            group.add(pointCloud);

            fitMetrics = pointData.metrics;
            fitCameraToScene();
        }

        function renderFrame() {
            if (useEDL && edlTarget !== null && edlMaterial !== null) {
                renderer.setRenderTarget(edlTarget);
                renderer.clear();
                renderer.render(scene, camera);
                renderer.setRenderTarget(null);

                edlMaterial.uniforms.tColor.value = edlTarget.texture;
                edlMaterial.uniforms.tDepth.value = edlTarget.depthTexture;
                renderer.render(edlScene, edlCamera);
            } else {
                renderer.render(scene, camera);
            }
        }

        function animate() {
            requestAnimationFrame(animate);
            if (!isVisible) {
                return;
            }

            group.rotation.y += 0.0035;
            group.rotation.x = fixedTiltX;
            camera.lookAt(0, 0, 0);
            renderFrame();
        }

        function createVisibilityObserver() {
            if (!("IntersectionObserver" in window)) {
                return;
            }

            var observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    isVisible = entry.isIntersecting;
                });
            }, { threshold: 0.1 });

            observer.observe(container);
        }

        async function loadPointCloud() {
            try {
                var basename = filePath.split("/").pop() || filePath;
                setStatus("Loading " + basename + "...");
                var response = await fetch(filePath, { cache: "no-store" });
                if (!response.ok) {
                    throw new Error("HTTP " + response.status);
                }

                var text = await response.text();
                var maxPoints = (classKey === "ceiling" || classKey === "floor") ? 200000 : 100000;
                var parsed = parseXYZRGB(text, maxPoints);
                if (parsed.positions.length === 0) {
                    throw new Error("No valid points parsed from file.");
                }

                setPointCloud(parsed);
                setStatus((parsed.positions.length / 3).toLocaleString() + " points");
            } catch (error) {
                setStatus("Failed to load " + filePath);
                console.error(error);
            }
        }

        initEDL();
        resize();
        window.addEventListener("resize", resize);
        createVisibilityObserver();
        animate();
        loadPointCloud();
    }

    function initGallery() {
        var showcase = document.getElementById("pc-showcase");
        if (showcase === null) {
            return;
        }

        CLASS_NAMES.forEach(function (name) {
            var cardBits = createCard(name);
            showcase.appendChild(cardBits.card);
            createViewer(cardBits.viewer, cardBits.status, "./data/" + name + "_sample.xyzrgb", name);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initGallery);
    } else {
        initGallery();
    }
})();
