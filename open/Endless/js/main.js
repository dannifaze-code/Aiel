/* ========================================
   ENDLESS - Horror Survival Game
   Main Game Engine
   ======================================== */

(() => {
    'use strict';

    // ======== GAME STATE ========
    const State = {
        current: 'menu',
        money: 150,
        health: 100,
        maxHealth: 100,
        armor: 0,
        maxArmor: 3,
        moral: 50,
        shift: 1,
        score: 0,
        enemiesDefeated: 0,
        weapon: 'flashlight',
        ammo: 0,
        weapons: { flashlight: true, bat: false, pistol: false },
        flashlightLevel: 1,
        prisoners: [],
        cells: [],
        cameras: [],
        escapee: null,
        escaper: null,
        escaperPosition: null,
        escapeWarningActive: false,
        prisonTimer: null,
        shiftTimer: null,
        shiftTimeLeft: 0,
        inspectedCells: 0,
        prisonPhase: 'brief', // brief | rounds | desk | chase
        nearCell: null
    };

    // ======== GENERATION DATA ========
    const FNAMES = ['Marcus','Derek','Vincent','Troy','Clarence','Ray','Gavin','Damon','Felix','Rex',
        'Nikolai','Bruno','Cyrus','Lance','Duke','Heath','Bram','Gunnar','Torin','Vasco'];
    const LNAMES = ['Voss','Kade','Holt','Briggs','Cross','Stone','Drake','Slade','Frost','Marsh'];
    const CRIMES = ['Serial Killer','Mass Murderer','Armed Rapist'];
    const CELL_IDS_LEFT = ['A01','A02','A03','A04','A05','A06'];
    const CELL_IDS_RIGHT = ['B01','B02','B03','B04','B05','B06'];
    const NOTES_Calm = [
        'Quiet. Just sitting.',
        'Reading a book.',
        'Staring at wall.',
        'Nothing unusual.',
        'Cooperative today.'
    ];
    const NOTES_Agitated = [
        'Pacing the cell aggressively.',
        'Screaming obscenities.',
        'Throwing things against the wall.',
        'Yelling about being innocent.',
        'Banging on the cell door.'
    ];
    const NOTES_Suspicious = [
        'Whispering when cameras are turned away.',
        'Scratching something into the wall.',
        'Hiding something under the mattress.',
        'Mapping the cell block from memory.',
        'Signaling to inmate across the hall.'
    ];
    const NOTES_Selfharm = [
        'Crying softly. Scratches on arms visible.',
        'Head against the wall repeatedly.',
        'Refusing to eat. Looking weak.',
        'Self-harm scars clearly visible.'
    ];
    const NOTES_Escape = [
        'Bending the bars on the window. Planning something.',
        'Has contraband wire — lock picking?',
        'Was heard discussing "tonight" with another inmate.',
        'Dug small hole near bed — tunnel?',
        'Stole a key card from last night shift.'
    ];

    function genInmate(i) {
        return {
            id: 'PR-' + String(1000 + i).slice(1),
            name: FNAMES[i % FNAMES.length] + ' ' + LNAMES[(i * 7 + 3) % LNAMES.length],
            crime: CRIMES[i % CRIMES.length],
            riskLevel: i % 3 === 0 ? 'High' : i % 3 === 1 ? 'Medium' : 'Low',
            behavior: 'calm',
            inspectCount: 0,
            hasClue: false,
            clueType: null
        };
    }

    function buildCellLayout() {
        State.cells = [];
        var idx = 0;
        var totalCells = 24;
        for (var s = 0; s < 2; s++) { // 0 = left, 1 = right
            var ids = s === 0 ? CELL_IDS_LEFT : CELL_IDS_RIGHT;
            for (var d = 0; d < 6; d++) {
                for (var lv = 0; lv < 2; lv++) { // 0 = ground, 1 = upper
                    State.cells.push({
                        id: 'Cell ' + ids[d] + (lv === 1 ? '-U' : ''),
                        side: s, doorIndex: d, level: lv,
                        inmate: idx < State.prisoners.length ? State.prisoners[idx] : null,
                        inspected: false
                    });
                    idx++;
                }
            }
        }
    }

    // ======== THREE.JS GLOBALS ========
    var scene, camera, renderer, controls;
    var flashLight, ambientLight;
    var velocity, direction, playerPosition;
    var animFrameId = null;
    var clock;
    var sceneType = '';
    var prisonAngle = 0;
    var moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
    var canMove = false;
    var FOREST_SIZE = 100;

    // Forest
    var forestData = [], forestObjects = [];
    var enemyMesh = null;
    var enemy = { active: false, x: 0, z: 0, health: 30, state: 'hiding', chasing: false, attackTimer: 0 };

    // ======== SCREEN MANAGEMENT ========
    function showScreen(id) {
        document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
        var el = document.getElementById(id);
        if (el) el.classList.add('active');
    }
    function showModal(id) { var el = document.getElementById(id); if(el){el.classList.add('active');el.style.display='';} }
    function closeModal(id) { var el = document.getElementById(id); if(el){el.classList.remove('active');el.style.display='none';} }
    function hideAllPanels() {
        ['prison-panel','camera-panel','shop-panel'].forEach(function(id){
            var el = document.getElementById(id);
            if(el){el.classList.remove('active');el.style.display='none';}
        });
        var cctv = document.getElementById('cctv-panel');
        if(cctv){cctv.classList.remove('active');cctv.style.display='';}
    }
    function hideWarning() {
        var el = document.getElementById('warning-overlay');
        if(el){el.classList.remove('active');el.style.display='none';}
        var el2 = document.getElementById('prison-escape-warning');
        if(el2){el2.classList.remove('active');el2.style.display='';}
    }

    // ======== UI UPDATE ========
    function updateUI() {
        var m = document.getElementById('money-display');
        if(m) m.textContent = '$' + State.money;
        var ml = document.getElementById('moral-display');
        if(ml){
            var l = 'NORMAL';
            if(State.moral >= 80) l = 'EXCELLENT';
            else if(State.moral >= 60) l = 'GOOD';
            else if(State.moral <= 30) l = 'QUESTIONABLE';
            else if(State.moral <= 10) l = 'CORRUPT';
            ml.textContent = 'MORAL: ' + l;
            ml.style.borderColor = State.moral >= 50 ? '#4a4' : '#a44';
        }
        var hf = document.getElementById('health-fill');
        if(hf) hf.style.width = (State.health / State.maxHealth) * 100 + '%';
        for(var i = 0; i < Math.max(State.maxArmor, 3); i++){
            var seg = document.getElementById('armor-segment-' + (i+1));
            if(seg) seg.classList.toggle('damaged', i >= State.armor);
        }
        var wn = document.getElementById('weapon-name');
        var ac = document.getElementById('ammo-count');
        if(wn) wn.textContent = State.weapon.toUpperCase();
        if(ac) ac.textContent = State.weapon === 'pistol' ? State.ammo : '\u221E';
    }
    function changeMoral(d) { State.moral = Math.max(0, Math.min(100, State.moral + d)); updateUI(); }
    function takeDamage(a) {
        if(State.armor > 0){ State.armor--; a = Math.floor(a * 0.5); }
        State.health = Math.max(0, State.health - a);
        updateUI();
        if(State.health <= 0) gameOver('Killed in the forest');
    }

    // ======== THREE.JS INIT ========
    function initWorld() {
        velocity = new THREE.Vector3();
        direction = new THREE.Vector3();
        playerPosition = new THREE.Vector3(0, 0, 0);
        if(!renderer){
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.domElement.style.position = 'absolute';
            renderer.domElement.style.top = '0';
            renderer.domElement.style.left = '0';
            renderer.domElement.style.display = 'block';
            var c = document.getElementById('canvas-container');
            c.innerHTML = '';
            c.appendChild(renderer.domElement);
            window.addEventListener('resize', onWindowResize);
        }
    }

    function onWindowResize() {
        if(!camera || !renderer) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ======== THREE.JS HELPERS ========
    function makePlane(w, h, color, px, py, pz, rx, mat) {
        var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat || new THREE.MeshStandardMaterial({color:color, roughness:1}));
        m.position.set(px, py, pz);
        if(rx) m.rotation.x = rx;
        return m;
    }
    function makeBox(w, h, d, color, px, py, pz, mat) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || new THREE.MeshStandardMaterial({color:color, roughness:0.8}));
        m.position.set(px, py, pz);
        return m;
    }

    function makeLine(px1, py1, pz1, px2, py2, pz2, color) {
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([px1,py1,pz1, px2,py2,pz2], 3));
        return new THREE.Line(geo, new THREE.LineBasicMaterial({color: color || 0x888880}));
    }
    function makeCyl(rt, rb, h, seg, color, px, py, pz) {
        var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), new THREE.MeshStandardMaterial({color:color, roughness:0.8}));
        m.position.set(px, py, pz);
        return m;
    }

    // ======== PRISON BLOCK 3D ========
    function buildPrisonWorld() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xc8c0b0);
        scene.fog = new THREE.FogExp2(0xc8c0b0, 0.008);

        camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 200);
        camera.position.set(0, 3.5, 4);
        camera.rotation.y = Math.PI / 2;

        // Ambient
        ambientLight = new THREE.AmbientLight(0xffeedd, 0.6);
        scene.add(ambientLight);
        var dirL = new THREE.DirectionalLight(0xffeedd, 0.5);
        dirL.position.set(15, 12, 15);
        scene.add(dirL);

        // Floor - tiled
        var tileMat = new THREE.MeshStandardMaterial({ color: 0x9e9890, roughness: 0.7 });
        scene.add(new THREE.Mesh(new THREE.PlaneGeometry(50, 26), tileMat)).rotation.x = -Math.PI/2;

        // Floor tile grid lines
        var gridMat = new THREE.LineBasicMaterial({ color: 0x888880 });
        for(var i=-25; i<=25; i+=2.5){
            scene.add(makeLine(-12.5, 0.01, i, 12.5, 0.01, i, 0x888880));
        }
        for(var j=-12; j<=12; j+=2.5){
            scene.add(makeLine(j, 0.01, -26, j, 0.01, 26, 0x888880));
        }

        var wallMat = new THREE.MeshStandardMaterial({ color: 0xd4cfc4, roughness: 0.9 });
        var wallMatDark = new THREE.MeshStandardMaterial({ color: 0xb0a898, roughness: 0.9 });

        // Ceiling
        var ceilMat = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 1 });
        scene.add(makePlane(50, 26, 0xe8e4dc, 0, 12, 0, Math.PI/2, ceilMat));

        // Ceiling tiles grid
        for(var ci = -24; ci <= 24; ci += 3){
            scene.add(makeLine(ci, 11.9, -25, ci, 11.9, 25, 0xccccbb));
        }

        // Back wall with large windows
        scene.add(makeBox(50, 12, 0.5, 0xd4cfc4, 0, 6, -13.2, wallMat));
        for(var wi = -20; wi <= 20; wi += 6){
            var winF = new THREE.Mesh(new THREE.PlaneGeometry(3, 6), new THREE.MeshBasicMaterial({color:0xddeeff}));
            winF.position.set(wi, 6, -12.85);
            scene.add(winF);
            var wf = makeBox(3.2, 0.2, 0.6, 0x888888, wi, 3, -13.0);
            scene.add(wf);
            var wf2 = makeBox(3.2, 0.2, 0.6, 0x888888, wi, 9, -13.0);
            scene.add(wf2);
        }

        // Side walls (cell back walls)
        scene.add(makeBox(0.5, 12, 50, 0xc8c0b4, -12.5, 6, 0, wallMatDark));
        scene.add(makeBox(0.5, 12, 50, 0xc8c0b4, 12.5, 6, 0, wallMatDark));

        // FRONT wall (open to view) is the "camera wall" behind the player
        scene.add(makeBox(50, 12, 0.5, 0xd4cfc4, 0, 6, 25.2, wallMat));

        // ====== BUILD CELLS - LEFT SIDE (+X) ======
        buildCellBlock(12.5, 'left');
        // ====== BUILD CELLS - RIGHT SIDE (-X) ======
        buildCellBlock(-12.5, 'right');

        // ====== CENTRAL DESK ======
        buildDesk();

        // ====== STAIRCASES ======
        buildStaircase(-8, -8);
        buildStaircase(-8, 8);

        // ====== SECOND FLOOR WALKWAY (connecting cells) ======
        buildWalkway();

        // ====== FLUORESCENT LIGHTS ======
        buildFluorescentLights();

        // ====== DECORATIVE PROPS ======
        buildDecorations();

        sceneType = 'prison';
        prisonAngle = 0;
        canMove = false;
        velocity.set(0,0,0);

        console.log('Prison block loaded, objects:', scene.children.length);
    }

    function buildCellBlock(side, sideName) {
        var isLeft = sideName === 'left';
        var sign = isLeft ? 1 : -1;
        // Cell width ~4m each, 6 cells along Z
        var cellSize = 4;
        var blockStart = -22;

        for(var d = 0; d < 6; d++){
            var z = blockStart + d * cellSize + cellSize/2;

            // Ground floor cell
            var cellFrontX = sign * 9.5;
            scene.add(makeBox(0.3, 5, cellSize, 0x888880, sign * 11, 2.5, z)); // Cell outer wall
            scene.add(makeBox(0.5, 0.3, cellSize, 0x666660, sign * 12.3, 5, z)); // Top wall
            scene.add(makeBox(0.5, 0.3, cellSize, 0x666660, sign * 12.3, 0.3, z)); // Threshold

            // Cell door
            var doorMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7 });
            scene.add(makeBox(0.15, 3.5, 0.9, 0x555555, cellFrontX, 1.75, z - 1.5, doorMat)); // Left frame
            scene.add(makeBox(0.15, 3.5, 0.9, 0x555555, cellFrontX, 1.75, z + 1.5, doorMat)); // Right frame
            scene.add(makeBox(0.15, 0.5, 4, 0x555555, cellFrontX, 3.5, z, doorMat)); // Top bar
            // Door panel
            scene.add(makeBox(0.1, 3.5, 3, new THREE.MeshStandardMaterial({color:0x666660, roughness:0.6}), cellFrontX, 1.75, z, doorMat));

            // Cell door window (visible through it)
            var winGeo = new THREE.PlaneGeometry(0.8, 0.8);
            var winMat = new THREE.MeshBasicMaterial({ color: 0x445544 });
            var win = new THREE.Mesh(winGeo, winMat);
            win.position.set(cellFrontX + sign * 0.1, 3, z);
            if(!isLeft) win.rotation.y = Math.PI;
            scene.add(win);

            // Cell number plaque
            var plaqueMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
            var plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), plaqueMat);
            plaque.position.set(cellFrontX + sign * 0.2, 4.2, z);
            if(!isLeft) plaque.rotation.y = Math.PI;
            scene.add(plaque);

            // Floor - cell interior
            var cf = new THREE.Mesh(new THREE.PlaneGeometry(2.5, cellSize), new THREE.MeshStandardMaterial({color:0xaaaaaa, roughness:1}));
            cf.rotation.x = -Math.PI/2;
            cf.position.set(sign * 11, 0.01, z);
            scene.add(cf);

            // Cell bed
            scene.add(makeBox(0.8, 0.4, 2, 0x886644, sign * 11, 0.4, z - 0.8));
            // Cell toilet
            scene.add(makeCyl(0.25, 0.3, 0.6, 8, 0xdddddd, sign * 11, 0.3, z + 1.3));

            // Vertical bars
            for(var b = -4; b <= 4; b += 0.5){
                var bar = makeCyl(0.02, 0.02, 3.5, 4, 0x777777, sign * 11 + sign * 0.1, 1.75, z + b);
                scene.add(bar);
            }

            // Upper floor cell visible above
            // Railing (walkway front)
            var railY = 5.5;
            var postMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
            for(var p = -4; p <= 4; p += 2){
                var post = makeCyl(0.04, 0.04, 1.5, 4, 0x888888, sign * 9.5, 5 + 0.75, z + p);
                scene.add(post);
            }
            var railBar = makeCyl(0.03, 0.03, 8, 4, 0x888888, sign * 9.5, 5.75, z);
            scene.add(railBar);

            // Upper cell floor (visible from below)
            var uf = makeBox(2.5, 0.2, cellSize, 0xaaaaaa, sign * 11, 5, z);
            scene.add(uf);

            // Upper cell bars visible above railing
            for(var ub = -3; ub <= 3; ub += 0.6){
                var ubar = makeCyl(0.015, 0.015, 2.5, 4, 0x777777, sign * 10.5, 6 + 1.25, z + ub);
                scene.add(ubar);
            }
            var topRail = makeCyl(0.03, 0.03, 6, 4, 0x888888, sign * 10.5, 8.5, z);
            scene.add(topRail);
        }
    }

    function buildDesk() {
        // U-shaped counter facing forward (-Z), centered at origin
        var deskMat = new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.6 });

        // Back panel (against player)
        scene.add(makeBox(4, 1.2, 0.15, 0x6b5335, 0, 0.6, 1.5, deskMat));
        // Left arm
        scene.add(makeBox(0.15, 1.2, 3, 0x6b5335, 2, 0.6, 0, deskMat));
        // Right arm
        scene.add(makeBox(0.15, 1.2, 3, 0x6b5335, -2, 0.6, 0, deskMat));
        // Countertop
        scene.add(makeBox(4.2, 0.1, 3.2, 0x4a4a4a, 0, 1.15, 0, new THREE.MeshStandardMaterial({color:0x4a4a4a, roughness:0.4})));

        // Monitor on desk (facing inward to player)
        var monitor = makeBox(0.6, 0.45, 0.05, 0x111111, 0.8, 1.5, -0.3);
        monitor.rotation.y = Math.PI;
        scene.add(monitor);
        // Screen glow
        var scr = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.4), new THREE.MeshBasicMaterial({color:0x223344}));
        scr.position.set(0.8, 1.5, -0.25);
        scr.rotation.y = Math.PI;
        scene.add(scr);

        // Phone
        scene.add(makeBox(0.3, 0.1, 0.2, 0x222222, -1.2, 1.25, -0.4));

        // Keyboard
        scene.add(makeBox(0.5, 0.03, 0.2, 0x222222, 0, 1.22, -0.6));

        // Chair
        var chair = makeCyl(0.25, 0.25, 0.06, 8, 0x222222, 0, 0.75, 3.5);
        scene.add(chair);
        var chairBack = makeBox(0.5, 0.8, 0.05, 0x222222, 0, 1.15, 3.8);
        scene.add(chairBack);
        var chairLeg = makeCyl(0.03, 0.03, 0.75, 6, 0x333333, 0, 0.35, 3.5);
        scene.add(chairLeg);

        // Filing cabinet under desk
        scene.add(makeBox(0.5, 0.8, 0.4, 0x555555, -1.5, 0.4, 2));
        scene.add(makeBox(0.5, 0.8, 0.4, 0x555555, 1.5, 0.4, 2));
    }

    function buildStaircase(zOffset) {
        var stepY = 0;
        var steps = 12;
        for(var s = 0; s < steps; s++){
            stepY += 0.42;
            scene.add(makeBox(1.5, 0.08, 0.8, 0x999990, s === 0 ? -7 : -5, stepY, zOffset + s * 0.45));
        }
        // Railings
        for(var r = 0; r < steps; r++){
            scene.add(makeCyl(0.02, 0.02, stepY + 1, 4, 0x888888, -7.8, (stepY + 1) / 2, zOffset + r * 0.45));
        }
        var railingBar = makeCyl(0.02, 0.02, steps * 0.45, 4, 0x888888, -7.8, stepY + 1, zOffset + (steps * 0.45) / 2);
        railingBar.rotation.x = Math.PI / 2;
        scene.add(railingBar);
    }

    function buildWalkway() {
        // Walkways connecting upper cells (both sides along Z)
        var blockStart = -22;
        var walkMat = new THREE.MeshStandardMaterial({ color: 0xaaaaa0, roughness: 0.8 });

        for(var d = 0; d < 6; d++){
            var z = blockStart + d * 4 + 2;
            // Left walkway platform
            var lw = makeBox(1.5, 0.15, 4, 0xaaaaa0, 10, 5, z, walkMat);
            scene.add(lw);
            // Right walkway platform
            var rw = makeBox(1.5, 0.15, 4, 0xaaaaa0, -10, 5, z, walkMat);
            scene.add(rw);
        }

        // Connecting walkway across the atrium at upper level
        scene.add(makeBox(20, 0.15, 2, 0x999990, 0, 5, 12));
        scene.add(makeBox(20, 0.15, 2, 0x999990, 0, 5, -12));

        // Railings for atrium walkways (no z-offset needed, just posts along walkway edges)
        for(var ri = -8; ri <= 8; ri += 2){
            scene.add(makeCyl(0.02, 0.02, 1.2, 4, 0x888888, ri, 5.6, 12));
            scene.add(makeCyl(0.02, 0.02, 1.2, 4, 0x888888, ri, 5.6, -12));
        }
        // horizontal bars
        scene.add(makeCyl(0.02, 0.02, 16, 4, 0x888888, 0, 5.6, 12));
        scene.add(makeCyl(0.02, 0.02, 16, 4, 0x888888, 0, 5.6, -12));
        scene.add(makeCyl(0.02, 0.02, 16, 4, 0x888888, 0, 6.2, 12));
        scene.add(makeCyl(0.02, 0.02, 16, 4, 0x888888, 0, 6.2, -12));
    }

    function buildFluorescentLights() {
        var lightMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
        // Main atrium lights
        for(var lz = -20; lz <= 20; lz += 8){
            var lf = makeBox(2, 0.08, 0.3, 0xffffee, 0, 11.8, lz, lightMat);
            scene.add(lf);
            // Point light for each fixture
            var pl = new THREE.PointLight(0xffffee, 0.3, 15);
            pl.position.set(0, 11, lz);
            scene.add(pl);
        }
    }

    function buildDecorations() {
        // Fire extinguisher
        scene.add(makeCyl(0.15, 0.15, 1, 8, 0xcc0000, 12, 0.5, 5));

        // Bulletin board on front wall
        scene.add(makeBox(2, 1.5, 0.05, 0x886622, 8, 5, 14.2)); // cork
        // Papers on board
        scene.add(makeBox(0.5, 0.4, 0.02, 0xcccccc, 7.5, 5.2, 14.23));
        scene.add(makeBox(0.4, 0.3, 0.02, 0xdddddd, 8.3, 5.1, 14.23));

        // Wall clock
        var clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({color:0xffffff}));
        clockFace.position.set(-5, 5, 12.25);
        scene.add(clockFace);
        var clockRim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 16), new THREE.MeshBasicMaterial({color:0x333333}));
        clockRim.position.copy(clockFace.position);
        scene.add(clockRim);

        // Intercom speaker
        scene.add(makeBox(0.3, 0.4, 0.08, 0x555555, 4, 4, 12));
    }

    // ======== FOREST WORLD ========
    function buildForestWorld() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x020202);
        scene.fog = new THREE.FogExp2(0x000000, 0.05);
        camera.position.set(0, 5, 0);

        ambientLight = new THREE.AmbientLight(0x111122, 0.4);
        scene.add(ambientLight);
        var moonL = new THREE.DirectionalLight(0x223344, 0.3);
        moonL.position.set(50, 100, 50);
        scene.add(moonL);

        flashLight = new THREE.SpotLight(0xffffcc, 2, 30 + State.flashlightLevel * 5, Math.PI / 4, 0.3, 1);
        camera.add(flashLight);
        camera.add(flashLight.target);
        flashLight.position.set(0, 0, 0);
        flashLight.target.position.set(0, 0, -1);
        scene.add(camera);

        scene.add(makePlane(FOREST_SIZE * 2, FOREST_SIZE * 2, 0x1a2b1a, 0, 0, 0, -Math.PI/2));
        generateForestScenery();
        createEnemy();
        document.getElementById('minimap').style.display = '';
        document.getElementById('crosshair').style.display = '';
        document.getElementById('vignette').style.display = '';
    }

    function generateForestScenery() {
        forestData = []; forestObjects = [];
        var cnt = 80 + Math.floor(Math.random() * 40);
        for(var i = 0; i < cnt; i++){
            var x = (Math.random()-0.5) * FOREST_SIZE * 2;
            var z = (Math.random()-0.5) * FOREST_SIZE * 2;
            if(Math.abs(x)<5 && Math.abs(z)<5) continue;
            var tree = new THREE.Group();
            var trunk = makeCyl(0.3, 0.4, 4 + Math.random()*3, 8, 0x3d2817, 0, 2, 0);
            tree.add(trunk);
            if(Math.random() < 0.15){
                var lv = new THREE.Mesh(new THREE.ConeGeometry(1.5+Math.random(), 4+Math.random()*3, 8),
                    new THREE.MeshStandardMaterial({color:0x0d2d0d, roughness:1}));
                lv.position.y = 5 + Math.random()*2;
                tree.add(lv);
            } else {
                var lv2 = new THREE.Mesh(new THREE.SphereGeometry(1.5+Math.random(), 8, 8),
                    new THREE.MeshStandardMaterial({color:0x1a3a1a, roughness:1}));
                lv2.position.y = 5 + Math.random()*2;
                tree.add(lv2);
            }
            var sc = 0.7 + Math.random() * 0.6;
            tree.scale.set(sc,sc,sc);
            tree.position.set(x,0,z);
            scene.add(tree);
            forestObjects.push(tree);
            forestData.push({x:x, z:z});
        }
        for(var j = 0; j < 30; j++){
            var rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3+Math.random()*0.5, 0),
                new THREE.MeshStandardMaterial({color:0x333333, roughness:1}));
            rock.position.set((Math.random()-0.5)*FOREST_SIZE, 0.1, (Math.random()-0.5)*FOREST_SIZE);
            rock.rotation.set(Math.random(), Math.random(), Math.random());
            scene.add(rock);
        }
    }

    function createEnemy() {
        if(!State.escapee) return;
        var cc = State.escapee.crime;
        var bodyC = cc === 'Serial Killer' ? 0x440044 : cc === 'Rapist' ? 0x442200 : 0x440000;
        var body = new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.4,3,8),
            new THREE.MeshStandardMaterial({color:bodyC, roughness:0.8}));
        var head = new THREE.Mesh(new THREE.SphereGeometry(0.4,8,8),
            new THREE.MeshStandardMaterial({color:0x8b7355, roughness:0.8}));
        head.position.y = 1.8;
        var eG = new THREE.SphereGeometry(0.08, 8, 8);
        var eM = new THREE.MeshBasicMaterial({color:0xff0000});
        var e1 = new THREE.Mesh(eG, eM); e1.position.set(-0.15, 1.85, -0.3);
        var e2 = new THREE.Mesh(eG, eM); e2.position.set(0.15, 1.85, -0.3);
        enemyMesh = new THREE.Group();
        enemyMesh.add(body); enemyMesh.add(head); enemyMesh.add(e1); enemyMesh.add(e2);
        enemyMesh.position.set((Math.random()-0.5)*40, 0, (Math.random()-0.5)*40 - 20);
        scene.add(enemyMesh);
        enemy.active = true;
        enemy.health = cc === 'Mass Murderer' ? 50 : cc === 'Serial Killer' ? 35 : 30;
        enemy.state = 'hiding';
    }

    // ========================
    // GAME FLOW
    // ========================

    function startNewGame() {
        showScreen('loading-screen');
        State.current = 'loading';
        var bar = document.getElementById('loading-progress');
        var txt = document.getElementById('loading-text');
        var items = ['Prison architecture', 'Inmate records', 'CCTV systems', 'Flashlight battery', 'Shift gear'];
        var p = 0;
        var iv = setInterval(function(){
            p += 20;
            if(bar) bar.style.width = p + '%';
            if(txt) txt.textContent = items[Math.floor(p/20)-1] || 'Starting...';
            if(p >= 100){
                clearInterval(iv);
                beginShift();
            }
        }, 500);

        // Reset
        State.money = 150; State.health = 100; State.maxHealth = 100;
        State.armor = 0; State.maxArmor = 3; State.moral = 50;
        State.score = 0; State.enemiesDefeated = 0;
        State.weapon = 'flashlight'; State.ammo = 0;
        State.weapons = { flashlight: true, bat: false, pistol: false };
        State.flashlightLevel = 1;
        State.escapee = null; State.escaper = null; State.escapeWarningActive = false;
        State.inspectedCells = 0; State.prisonPhase = 'brief';
        document.getElementById('brief-panel').classList.remove('active');
        document.getElementById('brief-panel').style.display = 'none';
    }

    function beginShift() {
        var ic = Math.min(6 + State.shift * 2, 20);
        State.prisoners = [];
        for(var i = 0; i < ic; i++) State.prisoners.push(genInmate(i));
        buildCellLayout();

        // Generate cameras (CCTV)
        State.cameras = [
            {id:'CAM-1', label:'Cell Block A - Ground', alert:false, angle:0},
            {id:'CAM-2', label:'Cell Block B - Ground', alert:false, angle:0},
            {id:'CAM-3', label:'Cell Block A - Upper', alert:false, angle:0},
            {id:'CAM-4', label:'Cell Block B - Upper', alert:false, angle:0},
            {id:'CAM-5', label:'Main Hall / Desk', alert:false, angle:0},
            {id:'CAM-6', label:'Cafeteria', alert:false, angle:0},
            {id:'CAM-7', label:'Yard', alert:false, angle:0},
            {id:'CAM-8', label:'Solitary', alert:false, angle:0}
        ];

        showScreen('game-ui');
        State.current = 'prison';

        initWorld();
        buildPrisonWorld();
        clock = new THREE.Clock();
        if(!animFrameId) gameLoop();

        var c = document.getElementById('canvas-container');
        if(c) c.style.display = 'block';

        // Show shift briefing
        var briefText = 'Shift ' + State.shift + ' has begun. You are assigned to <strong>Cell Block A</strong>.<br><br>' +
            '<strong>' + State.prisoners.length + '</strong> inmates housed.<br>' +
            'Begin your rounds: check each cell by approaching and pressing <strong>E</strong>.<br><br>' +
            '<em>Report anything suspicious. Stay alert.</em>';
        document.getElementById('brief-text').innerHTML = briefText;
        document.getElementById('brief-panel').classList.add('active');
        document.getElementById('brief-panel').style.display = 'flex';

        updateUI();
        updateMinimap();
    }

    function beginRounds() {
        document.getElementById('brief-panel').classList.remove('active');
        document.getElementById('brief-panel').style.display = 'none';
        State.prisonPhase = 'rounds';

        // Set up WASD camera
        controls = new THREE.PointerLockControls(camera, document.body);
        controls.addEventListener('unlock', function(){
            if(State.prisonPhase === 'rounds' || State.prisonPhase === 'desk') {
                // Only exit pointer lock during desk/brief, not rounds
            }
        });
        canMove = true;
        State.inspectedCells = 0;
        document.getElementById('crosshair').style.display = '';

        // Wire input handlers for prison rounds (before lock)
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        renderer.domElement.addEventListener('click', onPrisonClick);

        controls.lock();

        // Start timed events (escape chance)
        startPrisonTimers();
    }

    function startPrisonTimers() {
        if(State.prisonTimer) clearInterval(State.prisonTimer);
        State.prisonTimer = setInterval(function(){
            if(State.current !== 'prison') return;

            // Behavioral changes
            State.prisoners.forEach(function(p){
                if(p.inspected) return;
                var r = Math.random();
                if(p.riskLevel === 'High' && r < 0.08 * State.shift) p.behavior = 'agitated';
                else if(r < 0.02) p.behavior = 'selfharm';
                else if(r < 0.04) p.behavior = 'suspicious';
                else if(r < 0.06) p.behavior = 'calm';
                if(r < 0.01) { p.behavior = 'escape'; p.hasClue = true; p.clueType = 'escape'; }
            });

            // Camera alerts
            State.cameras.forEach(function(cam){
                if(Math.random() < 0.03 * State.shift) cam.alert = true;
                else if(cam.alert && Math.random() < 0.2) cam.alert = false;
            });

        }, 4000);

        // Escape timer
        if(State.shiftTimer) clearInterval(State.shiftTimer);
        State.shiftTimer = setInterval(function(){
            if(State.current !== 'prison' || State.escapeWarningActive) return;
            var highRisk = State.prisoners.filter(function(p){ return p.riskLevel === 'High' && p.behavior === 'escape'; });
            if(highRisk.length > 0 && Math.random() < 0.15 * State.shift){
                triggerEscape(highRisk[0]);
            }
        }, 6000);
    }

    function triggerEscape(prisoner) {
        State.escapee = prisoner;
        State.escaper = prisoner;
        State.escapeWarningActive = true;

        var pew = document.getElementById('prison-escape-warning');
        document.getElementById('pew-title').textContent = 'PRISON BREACH!';
        document.getElementById('pew-text').textContent =
            prisoner.id + ' (' + prisoner.name + ') has escaped into the forest!';
        pew.classList.add('active');
        pew.style.display = 'flex';

        document.getElementById('btn-chase-forest').onclick = function(){
            hideWarning();
            State.prisonPhase = 'chase';
            controls.unlock();
            canMove = false;
            startForestChase();
        };
        document.getElementById('btn-ignore-escape').onclick = function(){
            changeMoral(-10);
            State.escapeWarningActive = false;
            hideWarning();
        };
    }

    function startForestChase() {
        State.current = 'forest';
        cleanupPrison();
        buildForestWorld();
        sceneType = 'forest';

        controls = new THREE.PointerLockControls(camera, document.body);
        controls.addEventListener('unlock', function(){
            if(State.current === 'forest') controls.lock();
        });

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        renderer.domElement.addEventListener('mousedown', onMouseDown);

        controls.lock();
        clock = new THREE.Clock();
    }

    function returnToPrison() {
        State.current = 'prison';
        State.prisonPhase = 'desk';
        controls.unlock();
        canMove = false;

        document.getElementById('minimap').style.display = 'none';
        document.getElementById('crosshair').style.display = 'none';
        document.getElementById('vignette').style.display = 'none';

        buildPrisonWorld();
        clock = new THREE.Clock();

        document.getElementById('return-earnings').textContent = 'EARNED: $' + (50 + State.shift * 10);
        document.getElementById('timer-info').textContent = 'Shift: ' + State.shift + ' | Captured: ' + State.enemiesDefeated;
        showModal('return-screen');

        if(State.prisonTimer) clearInterval(State.prisonTimer);
        if(State.shiftTimer) clearInterval(State.shiftTimer);
        State.shiftTimeLeft = 120;
        State.shiftTimer = setInterval(function(){
            State.shiftTimeLeft--;
            if(State.shiftTimeLeft <= 0){ completeShift(); }
        }, 1000);
        startPrisonTimers();

        // Reset pointer for desk sitting
        camera.position.set(0, 3.5, 4);
        camera.rotation.set(0, Math.PI/2, 0);
    }

    function completeShift() {
        if(State.current !== 'prison') return;
        if(State.shiftTimer) clearInterval(State.shiftTimer);
        if(State.prisonTimer) clearInterval(State.prisonTimer);
        State.shift++;
        var earnings = 50 + State.shift * 20;
        State.money += earnings;
        document.getElementById('level-earnings').textContent = '$' + earnings;
        document.getElementById('level-stats').textContent = 'Shift ' + (State.shift-1) + ' Complete | Score: ' + State.score;
        showModal('level-complete');
    }

    function nextShift() {
        closeModal('level-complete');
        startNewGame();
    }

    function gameOver(reason) {
        State.current = 'game_over';
        if(State.prisonTimer) clearInterval(State.prisonTimer);
        if(State.shiftTimer) clearInterval(State.shiftTimer);
        cleanupPrison();
        controls.unlock();
        document.getElementById('death-reason').textContent = reason || 'YOU DIED';
        document.getElementById('death-stats').textContent =
            'Score: ' + State.score + ' | Shift: ' + State.shift + ' | Captured: ' + State.enemiesDefeated;
        showModal('game-over');
    }

    function cleanupPrison() {
        flashLight = null;
        enemyMesh = null;
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        if(renderer) renderer.domElement.removeEventListener('click', onPrisonClick);
        if(renderer) renderer.domElement.removeEventListener('mousedown', onMouseDown);
        if(controls) controls.unlock();
        enemy = { active:false, x:0, z:0, health:0, state:'hiding', chasing:false, attackTimer:0 };
        moveForward = moveBackward = moveLeft = moveRight = false;
        forestData = []; forestObjects = [];
    }

    function onPrisonClick() {
        // Delegate to onMouseDown for consistency (pistol in prison chase)
        onMouseDown();
    }

    // ========================
    // 3D CELL INTERACTION
    // ========================

    function raycastToCell() {
        var rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(0,0), camera);
        State.nearCell = null;

        // Check distance to each cell door position
        var blockStart = -22;
        for(var s = 0; s < 2; s++){
            var sign2 = s === 0 ? 1 : -1;
            var ids = s === 0 ? CELL_IDS_LEFT : CELL_IDS_RIGHT;
            for(var d = 0; d < 6; d++){
                var z = blockStart + d * 4 + 2;
                var dx = camera.position.x - sign2 * 9.5;
                var dz = camera.position.z - z;
                var dist = Math.sqrt(dx*dx + dz*dz);
                if(dist < 5){
                    var cellIdx = s * 12 + d * 2; // map to cells array
                    State.nearCell = State.cells[cellIdx];
                    return true;
                }
            }
        }
        return State.nearCell !== null;
    }

    function showCellTooltip() {
        var el = document.getElementById('cell-tooltip');
        if(!State.nearCell) {
            el.classList.remove('active');
            return;
        }
        var cell = State.nearCell;
        if(cell.inspected && !State.nearCell.inmate) {
            el.classList.remove('active');
            return;
        }
        var inmate = State.nearCell.inmate;
        el.querySelector('.cell-id').textContent = cell.id;
        el.querySelector('.inmate-name').textContent = inmate ? '- ' + inmate.name : '- Vacant';
        el.querySelector('.interact-prompt').textContent = '[Press E to Inspect]';
        el.classList.add('active');
    }

    function openCellDialog(cell) {
        var inmate = cell.inmate;
        if(!inmate) return;

        if(State.prisonPhase === 'chase') return;

        document.getElementById('inspect-title').textContent = 'INSPECT: ' + cell.id;
        cell.inspected = true;
        inmate.inspectCount++;
        State.inspectedCells++;

        var notesPool = inmate.behavior === 'escape' ? NOTES_Escape :
            inmate.behavior === 'selfharm' ? NOTES_Selfharm :
            inmate.behavior === 'suspicious' ? NOTES_Suspicious :
            inmate.behavior === 'agitated' ? NOTES_Agitated :
            NOTES_Calm;
        var note = notesPool[Math.floor(Math.random() * notesPool.length)];

        var body = document.getElementById('inspect-body');
        body.innerHTML =
            '<div class="inspect-stat"><span class="label">INMATE</span><span class="value">' + inmate.id + ' - ' + inmate.name + '</span></div>' +
            '<div class="inspect-stat"><span class="label">CHARGE</span><span class="value">' + inmate.crime + '</span></div>' +
            '<div class="inspect-stat"><span class="label">RISK LEVEL</span><span class="value risk-' + inmate.riskLevel.toLowerCase() + '">' + inmate.riskLevel.toUpperCase() + '</span></div>' +
            '<div class="inspect-stat"><span class="label">BEHAVIOR</span><span class="value behavior-' + inmate.behavior + '">' + inmate.behavior.toUpperCase() + '</span></div>' +
            '<div class="inspect-stat"><span class="label">INSPECTIONS</span><span class="value">' + inmate.inspectCount + '</span></div>' +
            '<div class="inspect-notes">' + note + '</div>';

        showModal('cell-inspect-modal');
        controls.unlock();
        canMove = false;

        // Action buttons
        document.querySelectorAll('.inspect-action-btn').forEach(function(btn){
            btn.onclick = function(){
                handleCellAction(btn.dataset.action, cell);
                closeModal('cell-inspect-modal');
                canMove = true;
                if(State.prisonPhase === 'rounds') {
                    controls.lock();
                }
            };
        });
    }

    function handleCellAction(action, cell) {
        var inmate = cell.inmate;
        if(!inmate) return;

        switch(action){
            case 'report':
                State.money += 15;
                changeMoral(3);
                if(inmate.behavior === 'escape' || inmate.behavior === 'selfharm'){
                    State.score += 50;
                    State.money += 30;
                    changeMoral(5);
                    // Prevent escape
                    inmate.behavior = 'calm';
                    inmate.hasClue = false;
                }
                break;
            case 'leave':
                if(inmate.behavior === 'escape') changeMoral(-8);
                break;
            case 'investigate':
                if(inmate.behavior === 'suspicious' || inmate.behavior === 'escape'){
                    State.score += 100;
                    changeMoral(5);
                    inmate.behavior = 'calm';
                    inmate.hasClue = false;
                } else if(inmate.behavior === 'selfharm'){
                    changeMoral(3);
                    State.money += 10;
                    inmate.behavior = 'calm';
                }
                break;
        }
        updateUI();
    }

    // ========================
    // CCTV SYSTEM
    // ========================

    function buildCCTVPanel() {
        var panel = document.getElementById('cctv-panel');
        if(!panel) return;

        var grid = document.getElementById('camera-grid');
        if(grid) grid.innerHTML = '';

        var hdr = panel.querySelector('.cctv-header');
        if(!hdr){
            hdr = document.createElement('div');
            hdr.className = 'cctv-header';
            hdr.innerHTML = '<h3>CCTV MONITORS</h3><button class="close-btn" id="btn-close-cctv">&times;</button>';
            panel.insertBefore(hdr, panel.firstChild);
        }

        var existingGrid = panel.querySelector('.cctv-grid');
        if(!existingGrid){
            existingGrid = document.createElement('div');
            existingGrid.className = 'cctv-grid';
            existingGrid.id = 'cctv-camera-grid';
            panel.appendChild(existingGrid);
        }

        State.cameras.forEach(function(cam, idx){
            var feed = document.createElement('div');
            feed.className = 'camera-feed' + (cam.alert ? ' alert' : '');
            feed.dataset.camIdx = idx;

            var cvs = document.createElement('canvas');
            cvs.width = 200; cvs.height = 150;
            drawCCTVFeed(cvs, cam, idx);

            var lbl = document.createElement('div');
            lbl.className = 'feed-label';
            lbl.textContent = cam.id + ' ' + cam.label;

            feed.appendChild(cvs);
            feed.appendChild(lbl);
            feed.addEventListener('click', function(){
                enlargeCamera(idx);
            });
            existingGrid.appendChild(feed);
        });

        document.getElementById('btn-close-cctv').onclick = function(){
            panel.classList.remove('active');
            panel.style.display = '';
        };
    }

    var enlargedCamera = -1;

    function enlargeCamera(idx) {
        var feeds = document.querySelectorAll('#cctv-camera-grid .camera-feed');
        if(idx === enlargedCamera){
            // Un-enlarge
            feeds.forEach(function(f){ f.classList.remove('enlarged'); });
            enlargedCamera = -1;
            return;
        }
        feeds.forEach(function(f){ f.classList.remove('enlarged'); });
        feeds[idx].classList.add('enlarged');
        enlargedCamera = idx;
    }

    function drawCCTVFeed(cvs, cam, idx) {
        var ctx = cvs.getContext('2d');
        var w = cvs.width, h = cvs.height;
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, w, h);
        cam.angle += 0.008;

        // Static
        for(var i = 0; i < 200; i++){
            ctx.fillStyle = 'rgba(255,255,255,' + Math.random()*0.06 + ')';
            ctx.fillRect(Math.random()*w, Math.random()*h, Math.random()*3, 1);
        }

        // View representation based on camera
        if(cam.label.indexOf('Cell') !== -1){
            // Show bars
            ctx.strokeStyle = 'rgba(100,100,100,0.4)';
            ctx.lineWidth = 2;
            for(var x = 30; x < w; x += 40){
                ctx.beginPath();
                ctx.moveTo(x, 10);
                ctx.lineTo(x, h-10);
                ctx.stroke();
            }
            // Silhouette
            var silX = 60 + Math.sin(cam.angle*4 + idx)*20 + w/3;
            var silY = 40 + Math.cos(cam.angle*3 + idx)*10 + 20;
            ctx.fillStyle = 'rgba(80,80,80,0.5)';
            ctx.beginPath();
            ctx.arc(silX, silY, 12, 0, Math.PI*2);
            ctx.fill();
            ctx.fillRect(silX - 8, silY + 12, 16, 30);
        } else if(cam.label.indexOf('Hall') !== -1){
            // Show long corridor
            ctx.fillStyle = '#1a1a1a';
            ctx.beginPath();
            ctx.moveTo(w/2-5, 60);
            ctx.lineTo(w/2+5, 60);
            ctx.lineTo(w/2+40, h);
            ctx.lineTo(w/2-40, h);
            ctx.closePath();
            ctx.fill();
        } else {
            // Generic room with objects
            ctx.fillStyle = 'rgba(40,40,30,0.6)';
            ctx.fillRect(40, 40, 80, 60);
            ctx.fillStyle = 'rgba(60,60,40,0.5)';
            ctx.fillRect(130, 60, 50, 40);
        }

        // Alert red overlay
        if(cam.alert){
            ctx.fillStyle = 'rgba(255,0,0,0.15)';
            ctx.fillRect(0,0,w,h);
            ctx.fillStyle = '#ff0000';
            ctx.font = 'bold 14px Courier New';
            ctx.textAlign = 'center';
            ctx.fillText('ALERT', w/2, h/2);
        }

        // Timestamp
        var now = new Date();
        ctx.fillStyle = 'rgba(200,200,200,0.4)';
        ctx.font = '9px Courier New';
        ctx.textAlign = 'left';
        ctx.fillText(cam.id, 5, 12);
        ctx.textAlign = 'right';
        ctx.fillText(now.getHours() + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0'), w-5, 12);
    }

    function toggleCCTV() {
        var panel = document.getElementById('cctv-panel');
        var isActive = panel && panel.classList.contains('active');
        hideAllPanels();
        if(!isActive && State.prisonPhase !== 'chase'){
            panel.style.display = 'flex';
            panel.classList.add('active');
            buildCCTVPanel();
        }
    }

    // ========================
    // SHOP
    // ========================
    var SHOP_ITEMS = {
        bat: {name:'Baseball Bat', price:20},
        pistol: {name:'Pistol (10 rounds)', price:50},
        armor: {name:'Armor Plate', price:100}
    };
    function buyItem(key) {
        var item = SHOP_ITEMS[key];
        if(!item || State.money < item.price) return;
        switch(key){
            case 'bat': if(State.weapons.bat) return; State.weapons.bat = true; State.weapon = 'bat'; break;
            case 'pistol': if(State.weapons.pistol) return; State.weapons.pistol = true; State.ammo = 10; State.weapon = 'pistol'; break;
            case 'armor': if(State.maxArmor >= 6) return; State.maxArmor++; State.armor++; break;
        }
        State.money -= item.price;
        updateUI();
    }

    // ========================
    // INPUT
    // ========================
    function onKeyDown(ev) {
        if(State.current === 'forest' || State.prisonPhase === 'rounds'){
            if(ev.code === 'KeyW' || ev.code === 'ArrowUp') moveForward = true;
            if(ev.code === 'KeyS' || ev.code === 'ArrowDown') moveBackward = true;
            if(ev.code === 'KeyA' || ev.code === 'ArrowLeft') moveLeft = true;
            if(ev.code === 'KeyD' || ev.code === 'ArrowRight') moveRight = true;
        }

        if(State.current === 'prison' && ev.code === 'KeyE' && State.nearCell && State.prisonPhase !== 'chase'){
            openCellDialog(State.nearCell);
        }
        if(State.current === 'prison' && ev.code === 'KeyT'){
            ev.preventDefault();
            toggleCCTV();
        }
        if(State.current === 'prison' && ev.code === 'KeyQ'){
            ev.preventDefault();
            var panel = document.getElementById('shop-panel');
            if(panel.style.display === 'block'){
                hideAllPanels();
            } else {
                hideAllPanels();
                panel.style.display = 'block';
                panel.classList.add('active');
            }
        }
        if(State.current === 'prison' && ev.code === 'KeyP' && !document.getElementById('brief-panel').classList.contains('active')){
            showModal('about-dialog');
        }
    }

    function onKeyUp(ev) {
        if(ev.code === 'KeyW' || ev.code === 'ArrowUp') moveForward = false;
        if(ev.code === 'KeyS' || ev.code === 'ArrowDown') moveBackward = false;
        if(ev.code === 'KeyA' || ev.code === 'ArrowLeft') moveLeft = false;
        if(ev.code === 'KeyD' || ev.code === 'ArrowRight') moveRight = false;
    }

    function onMouseDown() {
        if(State.current !== 'forest' || !controls || !controls.isLocked) return;
        if(State.weapon === 'pistol' && State.ammo <= 0) return;
        if(State.weapon === 'pistol') { State.ammo--; updateUI(); }
        if(enemy.active && enemyMesh){
            var dx = enemyMesh.position.x - camera.position.x;
            var dz = enemyMesh.position.z - camera.position.z;
            var dist = Math.sqrt(dx*dx + dz*dz);
            var range = State.weapon === 'flashlight' ? 5 : State.weapon === 'bat' ? 6 : 25;
            var dmg = State.weapon === 'flashlight' ? 3 : State.weapon === 'bat' ? 12 : 20;
            if(dist < range){
                enemy.health -= dmg;
                if(enemyMesh.children){
                    enemyMesh.children.forEach(function(c){
                        if(c.material && c.material.emissive) c.material.emissive.setHex(0xff0000);
                    });
                    setTimeout(function(){
                        if(enemyMesh && enemyMesh.children){
                            enemyMesh.children.forEach(function(c){
                                if(c.material && c.material.emissive) c.material.emissive.setHex(0x000000);
                            });
                        }
                    }, 100);
                }
                if(enemy.health <= 0) captureEnemy();
            }
        }
    }

    function captureEnemy() {
        if(enemyMesh){ scene.remove(enemyMesh); enemyMesh = null; }
        enemy.active = false;
        State.enemiesDefeated++;
        State.score += 100;
        var rew = 50 + State.shift * 10;
        State.money += rew;
        changeMoral(5);
        var idx = State.prisoners.indexOf(State.escaper);
        if(idx !== -1) State.prisoners.splice(idx, 1);
        State.escapee = null; State.escaper = null; State.escapeWarningActive = false;
        setTimeout(function(){
            cleanupPrison();
            returnToPrison();
        }, 1500);
    }

    // ========================
    // ENEMY AI
    // ========================
    function updateEnemy(dt, time) {
        if(!enemy.active || !enemyMesh) return;
        var dx = camera.position.x - enemyMesh.position.x;
        var dz = camera.position.z - enemyMesh.position.z;
        var dist = Math.sqrt(dx*dx + dz*dz);
        var det = 10 + State.shift;

        if(enemy.state === 'hiding'){
            enemyMesh.rotation.y += dt * 0.5;
            enemyMesh.position.x += Math.sin(time*0.5)*dt*2;
            enemyMesh.position.z += Math.cos(time*0.3)*dt*2;
            if(dist < det) enemy.state = 'chasing';
        } else if(enemy.state === 'chasing'){
            if(dist > det * 3){ enemy.state = 'hiding'; return; }
            var spd = 2 + State.shift * 0.3;
            var nx = dx/dist, nz = dz/dist;
            enemyMesh.position.x += nx * spd * dt * 10;
            enemyMesh.position.z += nz * spd * dt * 10;
            enemyMesh.rotation.y = Math.atan2(nx, nz);
            enemyMesh.children[0].position.y = Math.sin(time*5) * 0.2;
            if(dist < 3){ enemy.state = 'attacking'; enemy.attackTimer = 0; }
        } else if(enemy.state === 'attacking'){
            enemyMesh.rotation.y = Math.atan2(dx, dz);
            enemy.attackTimer += dt;
            if(enemy.attackTimer >= 1){
                takeDamage(State.escapee && State.escapee.crime === 'Mass Murderer' ? 20 : State.escapee && State.escapee.crime === 'Serial Killer' ? 15 : 12);
                enemy.attackTimer = 0;
                enemy.state = 'chasing';
            }
        }
        enemyMesh.position.x = Math.max(-FOREST_SIZE+2, Math.min(FOREST_SIZE-2, enemyMesh.position.x));
        enemyMesh.position.z = Math.max(-FOREST_SIZE+2, Math.min(FOREST_SIZE-2, enemyMesh.position.z));
    }

    // ========================
    // GAME LOOP
    // ========================
    function gameLoop() {
        if(State.current !== 'forest' && State.current !== 'prison') return;
        if(!scene || !camera || !renderer) return;

        var dt = clock.getDelta();
        var time = clock.getElapsedTime();

        if(State.current === 'prison'){
            if(State.prisonPhase === 'rounds' && canMove){
                // WASD movement
                velocity.x -= velocity.x * 10 * dt;
                velocity.z -= velocity.z * 10 * dt;
                direction.z = Number(moveForward) - Number(moveBackward);
                direction.x = Number(moveRight) - Number(moveLeft);
                direction.normalize();
                if(moveForward || moveBackward) velocity.z -= direction.z * 300 * dt;
                if(moveLeft || moveRight) velocity.x -= direction.x * 300 * dt;
                controls.moveRight(-velocity.x * dt);
                controls.moveForward(-velocity.z * dt);

                camera.position.y = 3.5;
                // Boundary clamp
                camera.position.x = Math.max(-12, Math.min(12, camera.position.x));
                camera.position.z = Math.max(-25, Math.min(25, camera.position.z));

                // Raycast to nearest cell
                raycastToCell();
                showCellTooltip();

            } else if(State.prisonPhase === 'desk' || State.prisonPhase === 'brief'){
                prisonAngle += dt * 0.15;
                var r = 8;
                camera.position.x = Math.cos(prisonAngle) * r;
                camera.position.z = Math.sin(prisonAngle) * r;
                camera.position.y = 4 + Math.sin(time*0.5)*0.3;
                camera.lookAt(0, 4, 0);
            }

            // Flashing lights
            scene.children.forEach(function(ch){
                if(ch.isMesh && ch.material && ch.material.isMeshBasicMaterial && !ch.isMesh2){
                    var c = ch.material.color;
                    if(c && c.r > 0.5 && c.b > 0.5) {
                        ch.material.color.setHSL(0.16 + Math.sin(time + ch.position.x)*0.02, 0.1, 0.7 + Math.sin(time*2)*0.05);
                    }
                }
            });

            // Update CCTV feeds periodically
            if(Math.floor(time*0.5) !== Math.floor((time-dt)*0.5)){
                State.cameras.forEach(function(cam, idx){
                    var gridEl = document.getElementById('cctv-camera-grid');
                    if(gridEl){
                        var feeds = gridEl.querySelectorAll('.camera-feed');
                        if(feeds[idx]){
                            var c2 = feeds[idx].querySelector('canvas');
                            if(c2) drawCCTVFeed(c2, cam, idx);
                        }
                    }
                });
            }

            renderer.render(scene, camera);
            animFrameId = requestAnimationFrame(gameLoop);
            return;
        }

        // FOREST
        velocity.x -= velocity.x * 10 * dt;
        velocity.z -= velocity.z * 10 * dt;
        velocity.y -= 9.8 * dt;
        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();
        if(moveForward || moveBackward) velocity.z -= direction.z * 400 * dt;
        if(moveLeft || moveRight) velocity.x -= direction.x * 400 * dt;
        controls.moveRight(-velocity.x * dt);
        controls.moveForward(-velocity.z * dt);
        camera.position.y = 5;
        camera.position.x = Math.max(-FOREST_SIZE+5, Math.min(FOREST_SIZE-5, camera.position.x));
        camera.position.z = Math.max(-FOREST_SIZE+5, Math.min(FOREST_SIZE-5, camera.position.z));
        playerPosition.copy(camera.position);
        updateEnemy(dt, time);
        if(flashLight) flashLight.intensity = 1.5 + Math.sin(time*10)*0.1;
        if(enemy.active && enemyMesh) State.escaperPosition = {x:enemyMesh.position.x, z:enemyMesh.position.z};
        if(Math.floor(time*2) !== Math.floor((time-dt)*2)) updateMinimap();
        renderer.render(scene, camera);
        animFrameId = requestAnimationFrame(gameLoop);
    }

    // ========================
    // MINIMAP
    // ========================
    function updateMinimap() {
        var cvs = document.getElementById('minimap-canvas');
        if(!cvs) return;
        var ctx = cvs.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, 128, 128);

        if(State.current === 'prison'){
            // Draw cell block outline
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1;
            // Left cells
            ctx.strokeRect(50, 5, 25, 118);
            // Right cells
            ctx.strokeRect(53, 5, 25, 118);
            // Desk
            ctx.fillStyle = '#444';
            ctx.fillRect(58, 50, 12, 10);
            // Player
            ctx.fillStyle = '#0f0';
            ctx.fillRect(62, 55, 3, 3);
            // Cells with inmates
            State.cells.forEach(function(cell, i){
                if(cell.inmate !== null){
                    var cx, cy;
                    if(cell.side === 0){ cx = 55 + cell.level * 10; } else { cx = 70 - cell.level * 10; }
                    cy = 5 + cell.doorIndex * 10;
                    ctx.fillStyle = cell.inspected ? '#0a0' : '#f80';
                    ctx.fillRect(cx, cy, 2, 2);
                }
            });
        } else if(State.current === 'forest'){
            // Forest minimap
            forestData.forEach(function(t){
                ctx.fillStyle = '#2a4a2a';
                ctx.fillRect(64+t.x/2, 64+t.z/2, 2, 2);
            });
            if(State.escaperPosition){
                ctx.fillStyle = '#ff0';
                ctx.beginPath();
                ctx.arc(64+State.escaperPosition.x/3, 64+State.escaperPosition.z/3, 3, 0, Math.PI*2);
                ctx.fill();
            }
            ctx.fillStyle = '#0f0';
            ctx.beginPath();
            ctx.arc(64, 64, 3, 0, Math.PI*2);
            ctx.fill();
        }
    }

    // ========================
    // INIT
    // ========================
    function initGame() {
        console.log('Endless loaded. THREE:', typeof THREE !== 'undefined' ? 'OK (' + THREE.REVISION + ')' : 'MISSING');

        document.getElementById('btn-new-game').addEventListener('click', startNewGame);
        document.getElementById('btn-load').addEventListener('click', function(){ alert('No saved games.'); });
        document.getElementById('btn-restart').addEventListener('click', function(){ closeModal('game-over'); startNewGame(); });
        document.getElementById('btn-menu').addEventListener('click', function(){ closeModal('game-over'); showScreen('main-menu'); State.current = 'menu'; });
        document.getElementById('btn-back-to-prison').addEventListener('click', function(){
            closeModal('return-screen');
            updateUI();
        });
        document.getElementById('btn-close-panel').addEventListener('click', hideAllPanels);
        document.getElementById('btn-close-cameras').addEventListener('click', hideAllPanels);
        document.getElementById('btn-close-shop').addEventListener('click', hideAllPanels);
        document.getElementById('btn-close-about').addEventListener('click', function(){ closeModal('about-dialog'); });
        document.getElementById('btn-close-inspect').addEventListener('click', function(){
            closeModal('cell-inspect-modal');
            canMove = true;
            if(State.prisonPhase === 'rounds') controls.lock();
        });
        document.getElementById('btn-brief-done').addEventListener('click', beginRounds);
        document.getElementById('btn-next-shift').addEventListener('click', nextShift);

        document.querySelectorAll('.shop-item').forEach(function(el){
            el.addEventListener('click', function(){ buyItem(el.dataset.item); });
        });

        showScreen('main-menu');
    }

    if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', initGame);
    } else {
        initGame();
    }
})();
