// ==UserScript==
// @name         Meeland Chat Aware
// @namespace    meeland-chat-aware
// @version      6.4.0
// @description  Meeland - Tasti disabilitati quando scrivi in chat
// @author       You
// @match        *crazygames.com*
// @match        *meeland.io*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    if (window._MeelandChatAware) return;
    window._MeelandChatAware = true;

    var MeelandState = {
        speedBoostEnabled: false,
        flyModeActive: false,
        flyingUp: false,
        flyingDown: false,
        noclipEnabled: false,
        homePos: null,
        tempWaypoint: null,
        lastTimerValue: null,
        lastJumpTime: 0,
        initialized: false,
        menuOpen: false,
        savedLocations: {},
        onlinePlayers: [],
        disabledBarriers: [],
        isChatOpen: false,
        settings: {
            autoLock: true,
            speedBoost: true,
            flyMode: true,
            teleport: true,
            noclip: false
        }
    };

    var KEYBINDS = [
        { key: 'M', action: 'Open/Close Menu' },
        { key: 'N', action: 'Toggle Noclip/Ghost Mode' },
        { key: 'Shift', action: 'Speed Boost (+4x velocity)' },
        { key: 'Q', action: 'Teleport to Home' },
        { key: 'Z', action: 'Teleport Back to Previous Location' },
        { key: 'CapsLock', action: 'Blink Forward (8.75 units)' },
        { key: 'Space (Single)', action: 'Jump' },
        { key: 'Space + Space', action: 'Enable Fly Mode' },
        { key: 'Space (In Fly)', action: 'Fly Upward' },
        { key: 'F (In Fly)', action: 'Fly Downward' }
    ];

    function getPlayer() {
        return window.pc.app.root.findByName('Player');
    }

    function getCamera() {
        return window.pc.app.root.findByName('Camera');
    }

    function isChatInputActive() {
        // Controlla se la chat è attiva cercando input/textarea focussati
        var activeElement = document.activeElement;
        if (!activeElement) return MeelandState.isChatOpen;
        
        var tagName = activeElement.tagName.toLowerCase();
        var inputType = activeElement.getAttribute('type') || '';
        
        // Se è input di tipo text/password o textarea, chat è attiva
        if ((tagName === 'input' && (inputType === 'text' || inputType === '')) ||
            tagName === 'textarea') {
            return true;
        }
        
        // Cerca anche per class/id della chat
        if (activeElement.className && typeof activeElement.className === 'string') {
            if (activeElement.className.includes('chat') || 
                activeElement.className.includes('input') ||
                activeElement.className.includes('message')) {
                return true;
            }
        }
        
        if (activeElement.id && typeof activeElement.id === 'string') {
            if (activeElement.id.includes('chat') || 
                activeElement.id.includes('input') ||
                activeElement.id.includes('message')) {
                return true;
            }
        }
        
        return MeelandState.isChatOpen;
    }

    function disableBarriers() {
        try {
            var root = window.pc.app.root;
            var disableColliders = function(node, depth) {
                if (depth > 20) return;
                
                if (node.name === 'Player' || node.name.includes('Player')) {
                    return;
                }
                
                if (node.name && (node.name.includes('Wall') || node.name.includes('wall') || 
                                  node.name.includes('Barrier') || node.name.includes('barrier') ||
                                  node.name.includes('Gate') || node.name.includes('gate') ||
                                  node.name.includes('Door') || node.name.includes('door') ||
                                  node.name.includes('Fence') || node.name.includes('fence') ||
                                  node.name.includes('Bar') || node.name.includes('bar'))) {
                    
                    if (node.collision && node.collision.enabled) {
                        MeelandState.disabledBarriers.push({
                            entity: node,
                            wasEnabled: true,
                            name: node.name
                        });
                        node.collision.enabled = false;
                    }
                }
                
                if (node.children) {
                    for (var i = 0; i < node.children.length; i++) {
                        disableColliders(node.children[i], depth + 1);
                    }
                }
            };
            
            disableColliders(root, 0);
            console.log('[Meeland] Disabled ' + MeelandState.disabledBarriers.length + ' barriers/walls');
        } catch (e) {
            console.error('[Meeland] Error disabling barriers:', e.message);
        }
    }

    function enableBarriers() {
        try {
            MeelandState.disabledBarriers.forEach(function(item) {
                if (item.entity && item.entity.collision) {
                    item.entity.collision.enabled = item.wasEnabled;
                }
            });
            MeelandState.disabledBarriers = [];
            console.log('[Meeland] Re-enabled all barriers');
        } catch (e) {
            console.error('[Meeland] Error enabling barriers:', e.message);
        }
    }

    function enableNoclip() {
        try {
            console.log('[Meeland] Enabling Noclip...');
            disableBarriers();
            MeelandState.noclipEnabled = true;
            console.log('[Meeland] Noclip ENABLED - Pass through barriers!');
            updateNoclipButton();
        } catch (e) {
            console.error('[Meeland] Enable noclip error:', e.message);
        }
    }

    function disableNoclip() {
        try {
            console.log('[Meeland] Disabling Noclip...');
            enableBarriers();
            MeelandState.noclipEnabled = false;
            console.log('[Meeland] Noclip DISABLED');
            updateNoclipButton();
        } catch (e) {
            console.error('[Meeland] Disable noclip error:', e.message);
        }
    }

    function toggleNoclip() {
        if (MeelandState.noclipEnabled) {
            disableNoclip();
        } else {
            enableNoclip();
        }
    }

    function updateNoclipButton() {
        var btn = document.getElementById('meeland-noclip-btn');
        if (btn) {
            btn.textContent = MeelandState.noclipEnabled ? 'Noclip: ON' : 'Noclip: OFF';
            btn.style.background = MeelandState.noclipEnabled ? '#ff6600' : '#00ff00';
            btn.style.color = MeelandState.noclipEnabled ? '#fff' : '#000';
        }
    }

    function analyzeOnlinePlayers() {
        var players = [];
        try {
            var root = window.pc.app.root;
            
            var searchForPlayers = function(node, depth) {
                if (depth > 5) return;
                
                if (node.name) {
                    if (/Player_\d+|Player\d+|player_\d+|player\d+/.test(node.name)) {
                        var pos = node.getPosition ? node.getPosition() : null;
                        var baseName = null;
                        var basePos = null;
                        
                        if (node.parent) {
                            for (var i = 0; i < node.parent.children.length; i++) {
                                var sibling = node.parent.children[i];
                                if (sibling.name && (sibling.name.includes('Base') || sibling.name.includes('base') || sibling.name.includes('Home') || sibling.name.includes('home'))) {
                                    baseName = sibling.name;
                                    basePos = sibling.getPosition ? sibling.getPosition() : null;
                                    break;
                                }
                            }
                        }
                        
                        var playerObj = {
                            name: node.name,
                            entity: node,
                            position: pos,
                            baseName: baseName,
                            basePos: basePos,
                            money: 0,
                            id: node.name
                        };
                        
                        try {
                            if (node.script && node.script.scripts) {
                                for (var j = 0; j < node.script.scripts.length; j++) {
                                    if (node.script.scripts[j].money !== undefined) {
                                        playerObj.money = node.script.scripts[j].money;
                                    }
                                    if (node.script.scripts[j].playerName) {
                                        playerObj.displayName = node.script.scripts[j].playerName;
                                    }
                                }
                            }
                        } catch (e) {}
                        
                        players.push(playerObj);
                    }
                }
                
                if (node.children) {
                    for (var i = 0; i < node.children.length; i++) {
                        searchForPlayers(node.children[i], depth + 1);
                    }
                }
            };
            
            searchForPlayers(root, 0);
        } catch (e) {
            console.error('[Meeland] Analyze players error:', e.message);
        }
        
        MeelandState.onlinePlayers = players;
        return players;
    }

    function getNativeTimer() {
        var bases = window.pc.app.root.findByName('Bases');
        if (!bases) return null;
        var bs = bases.script.petTycoonBasesManager;
        if (!bs) return null;
        var sid = window.pc.sessionId;
        for (var i = 0; i < bs.activeBases.length; i++) {
            if (bs.activeBases[i].data.sessionId === sid) {
                var baseEnt = bs.baseEntities[bs.activeBases[i].data.id];
                var btn = baseEnt.findByName('LockdownButton');
                var btnScript = btn.script.lockdownButton;
                var timeLeft = btnScript.lockdownTimeLeft || 0;
                var isActive = btnScript.isLockdownActive || false;
                return (isActive && timeLeft > 0) ? timeLeft : 0;
            }
        }
        return null;
    }

    function updateTimerDisplay(seconds) {
        var timerEl = document.getElementById('meeland-timer-display');
        if (!timerEl) return;
        var text = '-';
        var color = '#999';
        if (seconds === 0) {
            text = 'UNLOCKED';
            color = '#00ff00';
        } else if (seconds) {
            var m = Math.floor(seconds / 60);
            var s = Math.floor(seconds % 60);
            text = m + ':' + (s < 10 ? '0' : '') + s;
            color = seconds <= 10 ? '#ff0000' : seconds <= 20 ? '#ffaa00' : '#00ff00';
        }
        timerEl.textContent = text;
        timerEl.style.color = color;
    }

    function triggerLock() {
        if (!MeelandState.settings.autoLock) return;
        var bases = window.pc.app.root.findByName('Bases');
        var bs = bases.script.petTycoonBasesManager;
        var sid = window.pc.sessionId;
        for (var i = 0; i < bs.activeBases.length; i++) {
            if (bs.activeBases[i].data.sessionId === sid) {
                var baseEnt = bs.baseEntities[bs.activeBases[i].data.id];
                var btn = baseEnt.findByName('LockdownButton');
                var btnScript = btn.script.lockdownButton;
                var player = getPlayer();
                if (player && btnScript.onTriggerEnter) btnScript.onTriggerEnter(player);
                console.log('[Meeland] Lock triggered');
                return true;
            }
        }
        return false;
    }

    function teleport(player, pos) {
        if (!player || !pos) return;
        player.setPosition(pos.x, pos.y, pos.z);
        if (player.rigidbody) player.rigidbody.teleport(pos.x, pos.y, pos.z);
        console.log('[Meeland] Teleported to X:' + pos.x.toFixed(2) + ' Y:' + pos.y.toFixed(2) + ' Z:' + pos.z.toFixed(2));
    }

    function getTeleportPos(player, camera, distance) {
        var forward = camera.forward.clone();
        forward.y = 0;
        forward.normalize();
        var pos = player.getPosition();
        return new window.pc.Vec3(pos.x + forward.x * distance, pos.y, pos.z + forward.z * distance);
    }

    function applySpeedBoost(player, multiplier) {
        if (player && player.script && player.script.scripts) {
            for (var i = 0; i < player.script.scripts.length; i++) {
                if (player.script.scripts[i].speed !== undefined) {
                    player.script.scripts[i].speed = 7 * multiplier;
                    break;
                }
            }
        }
    }

    function resetSpeed(player) {
        if (player && player.script && player.script.scripts) {
            for (var i = 0; i < player.script.scripts.length; i++) {
                if (player.script.scripts[i].speed !== undefined) {
                    player.script.scripts[i].speed = 7;
                    break;
                }
            }
        }
    }

    function saveLocation(name) {
        var player = getPlayer();
        if (!player) return;
        var pos = player.getPosition();
        MeelandState.savedLocations[name] = { x: pos.x, y: pos.y, z: pos.z };
        console.log('[Meeland] Location saved: ' + name);
        updateLocationsList();
    }

    function loadLocation(name) {
        var pos = MeelandState.savedLocations[name];
        if (!pos) {
            console.log('[Meeland] Location not found: ' + name);
            return;
        }
        var player = getPlayer();
        teleport(player, { x: pos.x, y: pos.y, z: pos.z });
    }

    function deleteLocation(name) {
        delete MeelandState.savedLocations[name];
        console.log('[Meeland] Location deleted: ' + name);
        updateLocationsList();
    }

    function updateLocationsList() {
        var list = document.getElementById('meeland-locations-list');
        if (!list) return;
        list.innerHTML = '';
        for (var locName in MeelandState.savedLocations) {
            var item = document.createElement('div');
            item.style.cssText = 'margin: 8px 0; padding: 10px; background: #1a1a1a; border-radius: 3px; display: flex; justify-content: space-between; font-size: 13px;';
            var label = document.createElement('span');
            label.textContent = locName;
            label.style.cssText = 'cursor: pointer; flex: 1;';
            label.onclick = function(n) { return function() { loadLocation(n); }; }(locName);
            var delBtn = document.createElement('button');
            delBtn.textContent = 'X';
            delBtn.style.cssText = 'background: #ff3333; border: none; color: #fff; padding: 5px 10px; border-radius: 2px; cursor: pointer; font-size: 12px;';
            delBtn.onclick = function(n) { return function() { deleteLocation(n); }; }(locName);
            item.appendChild(label);
            item.appendChild(delBtn);
            list.appendChild(item);
        }
    }

    function updatePlayersList() {
        var list = document.getElementById('meeland-players-list');
        if (!list) return;
        list.innerHTML = '';
        
        var players = analyzeOnlinePlayers();
        
        if (players.length === 0) {
            var noPlayers = document.createElement('div');
            noPlayers.style.cssText = 'text-align: center; color: #888; padding: 10px; font-size: 13px;';
            noPlayers.textContent = 'No players found';
            list.appendChild(noPlayers);
            return;
        }
        
        players.forEach(function(player, index) {
            var item = document.createElement('div');
            item.style.cssText = 'margin: 10px 0; padding: 12px; background: #1a1a1a; border-radius: 4px; border-left: 3px solid #00ff00; font-size: 12px;';
            
            var playerName = player.displayName || player.name || ('Player ' + (index + 1));
            var posText = player.position ? ' X:' + player.position.x.toFixed(1) + ' Z:' + player.position.z.toFixed(1) : '';
            var baseText = player.basePos ? ' (Base X:' + player.basePos.x.toFixed(1) + ' Z:' + player.basePos.z.toFixed(1) + ')' : '';
            
            var header = document.createElement('div');
            header.style.cssText = 'font-weight: bold; color: #00ff00; margin-bottom: 8px; font-size: 14px;';
            header.textContent = playerName;
            
            var info = document.createElement('div');
            info.style.cssText = 'font-size: 12px; color: #888; margin-bottom: 8px;';
            info.innerHTML = 'Pos: ' + posText + baseText + '<br>Money: ' + player.money;
            
            var buttonsContainer = document.createElement('div');
            buttonsContainer.style.cssText = 'display: flex; gap: 5px; flex-wrap: wrap;';
            
            var telePBtn = document.createElement('button');
            telePBtn.textContent = 'Go to Player';
            telePBtn.style.cssText = 'background: #0066ff; border: none; color: #fff; padding: 6px 10px; border-radius: 2px; cursor: pointer; font-size: 11px;';
            telePBtn.onclick = function(p) {
                return function() {
                    if (p.position) {
                        var myPlayer = getPlayer();
                        teleport(myPlayer, p.position);
                    }
                };
            }(player);
            
            var teleBaseBtn = document.createElement('button');
            teleBaseBtn.textContent = 'Go to Base';
            teleBaseBtn.style.cssText = 'background: #ff6600; border: none; color: #fff; padding: 6px 10px; border-radius: 2px; cursor: pointer; font-size: 11px;';
            teleBaseBtn.onclick = function(p) {
                return function() {
                    if (p.basePos) {
                        var myPlayer = getPlayer();
                        teleport(myPlayer, p.basePos);
                    }
                };
            }(player);
            teleBaseBtn.disabled = !player.basePos;
            teleBaseBtn.style.opacity = player.basePos ? '1' : '0.5';
            
            buttonsContainer.appendChild(telePBtn);
            if (player.basePos) buttonsContainer.appendChild(teleBaseBtn);
            
            var moneyContainer = document.createElement('div');
            moneyContainer.style.cssText = 'display: flex; gap: 5px; margin-top: 8px;';
            
            var moneyInput = document.createElement('input');
            moneyInput.type = 'number';
            moneyInput.placeholder = 'Money';
            moneyInput.style.cssText = 'width: 70px; padding: 6px; font-size: 12px; border: 1px solid #00ff00; background: #000; color: #00ff00;';
            moneyInput.value = player.money || 0;
            
            var setMoneyBtn = document.createElement('button');
            setMoneyBtn.textContent = 'Set';
            setMoneyBtn.style.cssText = 'background: #00ff00; border: none; color: #000; padding: 6px 10px; border-radius: 2px; cursor: pointer; font-size: 11px; font-weight: bold;';
            setMoneyBtn.onclick = function(p, input) {
                return function() {
                    var amount = parseInt(input.value);
                    if (!isNaN(amount)) {
                        try {
                            if (p.entity && p.entity.script && p.entity.script.scripts) {
                                for (var i = 0; i < p.entity.script.scripts.length; i++) {
                                    if (p.entity.script.scripts[i].money !== undefined) {
                                        p.entity.script.scripts[i].money = amount;
                                        console.log('[Meeland] ' + p.name + ' money set to: ' + amount);
                                        p.money = amount;
                                    }
                                }
                            }
                            updatePlayersList();
                        } catch (e) {
                            console.error('[Meeland] Set money error:', e.message);
                        }
                    }
                };
            }(player, moneyInput);
            
            var addMoneyBtn = document.createElement('button');
            addMoneyBtn.textContent = 'Add';
            addMoneyBtn.style.cssText = 'background: #00aa00; border: none; color: #fff; padding: 6px 10px; border-radius: 2px; cursor: pointer; font-size: 11px; font-weight: bold;';
            addMoneyBtn.onclick = function(p, input) {
                return function() {
                    var amount = parseInt(input.value);
                    if (!isNaN(amount)) {
                        try {
                            if (p.entity && p.entity.script && p.entity.script.scripts) {
                                for (var i = 0; i < p.entity.script.scripts.length; i++) {
                                    if (p.entity.script.scripts[i].money !== undefined) {
                                        p.entity.script.scripts[i].money = (p.entity.script.scripts[i].money || 0) + amount;
                                        console.log('[Meeland] ' + p.name + ' money added: ' + amount);
                                        p.money = p.entity.script.scripts[i].money;
                                        input.value = '';
                                    }
                                }
                            }
                            updatePlayersList();
                        } catch (e) {
                            console.error('[Meeland] Add money error:', e.message);
                        }
                    }
                };
            }(player, moneyInput);
            
            moneyContainer.appendChild(moneyInput);
            moneyContainer.appendChild(setMoneyBtn);
            moneyContainer.appendChild(addMoneyBtn);
            
            item.appendChild(header);
            item.appendChild(info);
            item.appendChild(buttonsContainer);
            item.appendChild(moneyContainer);
            list.appendChild(item);
        });
    }

    function toggleMenu() {
        var menu = document.getElementById('meeland-menu-panel');
        if (menu) {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            MeelandState.menuOpen = menu.style.display === 'block';
        }
    }

    function updateMenuCheckboxes() {
        document.getElementById('chk-autolock').checked = MeelandState.settings.autoLock;
        document.getElementById('chk-speedboost').checked = MeelandState.settings.speedBoost;
        document.getElementById('chk-flymode').checked = MeelandState.settings.flyMode;
        document.getElementById('chk-teleport').checked = MeelandState.settings.teleport;
        document.getElementById('chk-noclip').checked = MeelandState.settings.noclip;
    }

    function createUI() {
        if (document.getElementById('meeland-ui')) return;

        var style = document.createElement('style');
        style.textContent = `
            #meeland-ui { position: fixed; left: 15px; bottom: 15px; z-index: 999999; font-family: monospace; }
            #meeland-container { background: #0a0a0a; border: 3px solid #00ff00; padding: 15px; border-radius: 8px; color: #00ff00; min-width: 300px; box-shadow: 0 0 20px rgba(0,255,0,0.3); max-height: 90vh; overflow-y: auto; font-size: 14px; }
            #meeland-title { font-size: 15px; margin-bottom: 12px; opacity: 0.7; text-align: center; cursor: pointer; font-weight: bold; }
            #meeland-title:hover { opacity: 1; }
            #meeland-timer-display { font-size: 32px; font-weight: bold; color: #999; text-align: center; margin-bottom: 10px; }
            #meeland-status { font-size: 13px; text-align: center; color: #00ff00; margin-bottom: 10px; }
            #meeland-keys { font-size: 12px; color: #888; line-height: 1.6; text-align: left; }
            #meeland-menu-btn { background: #00ff00; color: #000; border: none; padding: 12px 15px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 10px; width: 100%; font-size: 13px; }
            #meeland-menu-btn:hover { background: #00cc00; }
            #meeland-noclip-btn { background: #00ff00; color: #000; border: none; padding: 12px 15px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 10px; width: 100%; font-size: 13px; }
            #meeland-noclip-btn:hover { background: #00cc00; }
            #meeland-menu-panel { display: none; background: #1a1a1a; border: 2px solid #00ff00; border-radius: 8px; padding: 15px; margin-top: 10px; color: #00ff00; font-size: 13px; max-height: 600px; overflow-y: auto; }
            .meeland-menu-item { display: flex; align-items: center; margin: 10px 0; font-size: 13px; }
            .meeland-menu-item input[type="checkbox"] { margin-right: 10px; cursor: pointer; width: 18px; height: 18px; }
            .meeland-menu-item label { cursor: pointer; flex: 1; }
            .meeland-menu-divider { border-top: 1px solid #00ff00; margin: 12px 0; opacity: 0.3; }
            .meeland-menu-title { font-weight: bold; color: #00ff00; margin: 12px 0 10px 0; text-align: center; font-size: 14px; }
            .meeland-tab-btn { background: #00ff00; color: #000; border: 1px solid #00ff00; padding: 8px 12px; margin: 4px; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: bold; }
            .meeland-tab-btn.active { background: #00cc00; }
            .meeland-tab-btn:hover { background: #00dd00; }
            .meeland-tab-content { display: none; margin-top: 12px; }
            .meeland-tab-content.active { display: block; }
            #meeland-locations-list, #meeland-players-list, #meeland-keybinds-list { max-height: 400px; overflow-y: auto; }
            .meeland-loc-input { width: 70%; padding: 8px; margin: 8px 0; font-size: 12px; border: 1px solid #00ff00; background: #000; color: #00ff00; }
            .meeland-save-btn { background: #00ff00; color: #000; border: none; padding: 8px 12px; border-radius: 2px; cursor: pointer; margin-left: 5px; font-size: 12px; font-weight: bold; }
            .meeland-save-btn:hover { background: #00cc00; }
            .meeland-keybind-item { display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #0a0a0a; margin: 6px 0; border-radius: 3px; border-left: 3px solid #00ff00; font-size: 12px; }
            .meeland-keybind-key { font-weight: bold; color: #ffaa00; min-width: 90px; font-size: 13px; }
            .meeland-keybind-action { color: #888; font-size: 12px; flex: 1; margin-left: 10px; }
        `;
        document.head.appendChild(style);

        var ui = document.createElement('div');
        ui.id = 'meeland-ui';

        var container = document.createElement('div');
        container.id = 'meeland-container';

        var title = document.createElement('div');
        title.id = 'meeland-title';
        title.textContent = 'MEELAND v6.4';
        title.onclick = toggleMenu;

        var timer = document.createElement('div');
        timer.id = 'meeland-timer-display';
        timer.textContent = '-';

        var status = document.createElement('div');
        status.id = 'meeland-status';
        status.textContent = 'READY';

        var keys = document.createElement('div');
        keys.id = 'meeland-keys';
        keys.innerHTML = 'M=Menu | N=Noclip | Shift=Speed<br>Q=Home | Z=Back | CapsLock=Blink<br>Space+Space=Fly | T=Chat';

        var menuBtn = document.createElement('button');
        menuBtn.id = 'meeland-menu-btn';
        menuBtn.textContent = 'MENU (M)';
        menuBtn.onclick = toggleMenu;

        var noclipBtn = document.createElement('button');
        noclipBtn.id = 'meeland-noclip-btn';
        noclipBtn.textContent = 'Noclip: OFF';
        noclipBtn.onclick = toggleNoclip;

        container.appendChild(title);
        container.appendChild(timer);
        container.appendChild(status);
        container.appendChild(keys);
        container.appendChild(menuBtn);
        container.appendChild(noclipBtn);

        var menuPanel = document.createElement('div');
        menuPanel.id = 'meeland-menu-panel';

        var tabContainer = document.createElement('div');
        tabContainer.style.cssText = 'text-align: center; margin-bottom: 12px; display: flex; flex-wrap: wrap; justify-content: center;';

        var settingsTab = document.createElement('button');
        settingsTab.className = 'meeland-tab-btn active';
        settingsTab.textContent = 'Settings';
        settingsTab.onclick = function() {
            document.getElementById('meeland-settings-tab').classList.add('active');
            document.getElementById('meeland-teleport-tab').classList.remove('active');
            document.getElementById('meeland-players-tab').classList.remove('active');
            document.getElementById('meeland-keybinds-tab').classList.remove('active');
            settingsTab.classList.add('active');
            teleportTab.classList.remove('active');
            playersTab.classList.remove('active');
            keybindsTab.classList.remove('active');
        };

        var teleportTab = document.createElement('button');
        teleportTab.className = 'meeland-tab-btn';
        teleportTab.textContent = 'Teleport';
        teleportTab.onclick = function() {
            document.getElementById('meeland-settings-tab').classList.remove('active');
            document.getElementById('meeland-teleport-tab').classList.add('active');
            document.getElementById('meeland-players-tab').classList.remove('active');
            document.getElementById('meeland-keybinds-tab').classList.remove('active');
            settingsTab.classList.remove('active');
            teleportTab.classList.add('active');
            playersTab.classList.remove('active');
            keybindsTab.classList.remove('active');
            updateLocationsList();
        };

        var playersTab = document.createElement('button');
        playersTab.className = 'meeland-tab-btn';
        playersTab.textContent = 'Players';
        playersTab.onclick = function() {
            document.getElementById('meeland-settings-tab').classList.remove('active');
            document.getElementById('meeland-teleport-tab').classList.remove('active');
            document.getElementById('meeland-players-tab').classList.add('active');
            document.getElementById('meeland-keybinds-tab').classList.remove('active');
            settingsTab.classList.remove('active');
            teleportTab.classList.remove('active');
            playersTab.classList.add('active');
            keybindsTab.classList.remove('active');
            updatePlayersList();
        };

        var keybindsTab = document.createElement('button');
        keybindsTab.className = 'meeland-tab-btn';
        keybindsTab.textContent = 'Keybinds';
        keybindsTab.onclick = function() {
            document.getElementById('meeland-settings-tab').classList.remove('active');
            document.getElementById('meeland-teleport-tab').classList.remove('active');
            document.getElementById('meeland-players-tab').classList.remove('active');
            document.getElementById('meeland-keybinds-tab').classList.add('active');
            settingsTab.classList.remove('active');
            teleportTab.classList.remove('active');
            playersTab.classList.remove('active');
            keybindsTab.classList.add('active');
        };

        tabContainer.appendChild(settingsTab);
        tabContainer.appendChild(teleportTab);
        tabContainer.appendChild(playersTab);
        tabContainer.appendChild(keybindsTab);
        menuPanel.appendChild(tabContainer);

        // Settings Tab
        var settingsTab_content = document.createElement('div');
        settingsTab_content.id = 'meeland-settings-tab';
        settingsTab_content.className = 'meeland-tab-content active';

        var settingsTitle = document.createElement('div');
        settingsTitle.className = 'meeland-menu-title';
        settingsTitle.textContent = 'SETTINGS';
        settingsTab_content.appendChild(settingsTitle);

        var settings = [
            { id: 'chk-autolock', label: 'Auto-Lock', key: 'autoLock' },
            { id: 'chk-speedboost', label: 'Speed Boost', key: 'speedBoost' },
            { id: 'chk-flymode', label: 'Fly Mode', key: 'flyMode' },
            { id: 'chk-teleport', label: 'Teleport', key: 'teleport' },
            { id: 'chk-noclip', label: 'Noclip Toggle', key: 'noclip' }
        ];

        settings.forEach(function(setting) {
            var item = document.createElement('div');
            item.className = 'meeland-menu-item';

            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = setting.id;
            checkbox.checked = MeelandState.settings[setting.key];
            checkbox.onchange = function() {
                MeelandState.settings[setting.key] = checkbox.checked;
                console.log('[Meeland] ' + setting.label + ': ' + (checkbox.checked ? 'ON' : 'OFF'));
            };

            var label = document.createElement('label');
            label.htmlFor = setting.id;
            label.textContent = setting.label;

            item.appendChild(checkbox);
            item.appendChild(label);
            settingsTab_content.appendChild(item);
        });

        menuPanel.appendChild(settingsTab_content);

        // Teleport Tab
        var teleportTab_content = document.createElement('div');
        teleportTab_content.id = 'meeland-teleport-tab';
        teleportTab_content.className = 'meeland-tab-content';

        var teleportTitle = document.createElement('div');
        teleportTitle.className = 'meeland-menu-title';
        teleportTitle.textContent = 'SAVED LOCATIONS';
        teleportTab_content.appendChild(teleportTitle);

        var locInput = document.createElement('input');
        locInput.type = 'text';
        locInput.placeholder = 'Location name';
        locInput.className = 'meeland-loc-input';

        var saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.className = 'meeland-save-btn';
        saveBtn.onclick = function() {
            var name = locInput.value;
            if (name) {
                saveLocation(name);
                locInput.value = '';
            }
        };

        var inputContainer = document.createElement('div');
        inputContainer.appendChild(locInput);
        inputContainer.appendChild(saveBtn);
        teleportTab_content.appendChild(inputContainer);

        var locationsList = document.createElement('div');
        locationsList.id = 'meeland-locations-list';
        teleportTab_content.appendChild(locationsList);

        menuPanel.appendChild(teleportTab_content);

        // Players Tab
        var playersTab_content = document.createElement('div');
        playersTab_content.id = 'meeland-players-tab';
        playersTab_content.className = 'meeland-tab-content';

        var playersTitle = document.createElement('div');
        playersTitle.className = 'meeland-menu-title';
        playersTitle.textContent = 'PLAYERS ONLINE';
        playersTab_content.appendChild(playersTitle);

        var playersList = document.createElement('div');
        playersList.id = 'meeland-players-list';
        playersTab_content.appendChild(playersList);

        menuPanel.appendChild(playersTab_content);

        // Keybinds Tab
        var keybindsTab_content = document.createElement('div');
        keybindsTab_content.id = 'meeland-keybinds-tab';
        keybindsTab_content.className = 'meeland-tab-content';

        var keybindsTitle = document.createElement('div');
        keybindsTitle.className = 'meeland-menu-title';
        keybindsTitle.textContent = 'KEYBINDS';
        keybindsTab_content.appendChild(keybindsTitle);

        var keybindsList = document.createElement('div');
        keybindsList.id = 'meeland-keybinds-list';
        
        KEYBINDS.forEach(function(bind) {
            var item = document.createElement('div');
            item.className = 'meeland-keybind-item';
            
            var keySpan = document.createElement('span');
            keySpan.className = 'meeland-keybind-key';
            keySpan.textContent = bind.key;
            
            var actionSpan = document.createElement('span');
            actionSpan.className = 'meeland-keybind-action';
            actionSpan.textContent = bind.action;
            
            item.appendChild(keySpan);
            item.appendChild(actionSpan);
            keybindsList.appendChild(item);
        });

        keybindsTab_content.appendChild(keybindsList);
        menuPanel.appendChild(keybindsTab_content);

        container.appendChild(menuPanel);
        ui.appendChild(container);
        document.body.appendChild(ui);
        console.log('[Meeland] UI created');
    }

    function init() {
        if (MeelandState.initialized) return;
        MeelandState.initialized = true;
        console.log('[Meeland] Initializing');
        var player = getPlayer();
        var camera = getCamera();
        if (!player || !camera) {
            console.log('[Meeland] Error: Player or Camera not found');
            return;
        }
        console.log('[Meeland] Game Ready');
        MeelandState.homePos = player.getPosition().clone();
        createUI();
        updateMenuCheckboxes();
        
        setTimeout(function() {
            if (MeelandState.settings.autoLock) triggerLock();
        }, 2000);

        var mainLoop = setInterval(function() {
            var timerValue = getNativeTimer();
            if (timerValue !== null) {
                updateTimerDisplay(timerValue);
                if (timerValue === 0 && MeelandState.lastTimerValue !== null && MeelandState.lastTimerValue > 0) {
                    if (MeelandState.settings.autoLock) triggerLock();
                }
                MeelandState.lastTimerValue = timerValue;
            } else {
                updateTimerDisplay(null);
            }
            if (MeelandState.speedBoostEnabled && MeelandState.settings.speedBoost) {
                applySpeedBoost(player, 4);
            } else {
                resetSpeed(player);
            }
        }, 50);

        document.addEventListener('keydown', function(e) {
            // NON attivare funzioni se la chat è aperta
            if (isChatInputActive()) {
                return;
            }
            
            if (e.key === 'm' || e.key === 'M') {
                e.preventDefault();
                toggleMenu();
            }
            if (e.key === 'n' || e.key === 'N') {
                e.preventDefault();
                toggleNoclip();
            }
            if (e.key === 'Shift' && !MeelandState.speedBoostEnabled && MeelandState.settings.speedBoost) {
                MeelandState.speedBoostEnabled = true;
                console.log('[Meeland] Speed ON');
            }
            if ((e.key === 'q' || e.key === 'Q') && MeelandState.homePos) {
                MeelandState.tempWaypoint = player.getPosition().clone();
                teleport(player, MeelandState.homePos);
            }
            if ((e.key === 'z' || e.key === 'Z') && MeelandState.tempWaypoint) {
                teleport(player, MeelandState.tempWaypoint);
            }
            if (e.key === 'CapsLock' && MeelandState.settings.teleport) {
                e.preventDefault();
                var pos = getTeleportPos(player, camera, 8.75);
                if (pos) teleport(player, pos);
            }
            if (e.code === 'Space' && MeelandState.settings.flyMode) {
                var kcc = player.script.kcc;
                if (kcc) {
                    var now = Date.now();
                    if (MeelandState.flyModeActive) {
                        MeelandState.flyingUp = true;
                    } else if (now - MeelandState.lastJumpTime < 400) {
                        MeelandState.flyModeActive = true;
                        kcc.gravity = 0;
                        MeelandState.flyingUp = true;
                        console.log('[Meeland] Fly ON');
                    }
                    MeelandState.lastJumpTime = now;
                }
            }
            if (e.code === 'KeyF' && MeelandState.flyModeActive && MeelandState.settings.flyMode) {
                MeelandState.flyingDown = true;
            }
        }, true);

        document.addEventListener('keyup', function(e) {
            if (e.key === 'Shift' && MeelandState.speedBoostEnabled) {
                MeelandState.speedBoostEnabled = false;
                console.log('[Meeland] Speed OFF');
            }
            if (e.code === 'Space') MeelandState.flyingUp = false;
            if (e.code === 'KeyF') MeelandState.flyingDown = false;
        }, true);

        var flyLoop = setInterval(function() {
            if (!MeelandState.flyModeActive || !MeelandState.settings.flyMode) return;
            var kcc = player.script.kcc;
            if (!kcc) return;
            if (kcc._grounded) {
                MeelandState.flyModeActive = false;
                kcc.gravity = -30;
                MeelandState.flyingUp = false;
                MeelandState.flyingDown = false;
                console.log('[Meeland] Fly OFF');
                return;
            }
            if (MeelandState.flyingUp) {
                kcc._velY = 10;
            } else if (MeelandState.flyingDown) {
                kcc._velY = -10;
            } else {
                kcc._velY = 0;
            }
        }, 16);

        setInterval(function() {
            if (MeelandState.menuOpen && document.getElementById('meeland-players-tab').classList.contains('active')) {
                updatePlayersList();
            }
        }, 3000);
    }

    var attempts = 0;
    var waitInterval = setInterval(function() {
        attempts++;
        if (window.pc && window.pc.app && window.pc.app.root) {
            clearInterval(waitInterval);
            console.log('[Meeland] PlayCanvas detected');
            init();
        } else if (attempts > 400) {
            clearInterval(waitInterval);
            console.log('[Meeland] Error: Timeout');
        }
    }, 50);
})();