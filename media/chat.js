/* AI Assistant Chat Webview Scripts */
(function () {
    var vscode = acquireVsCodeApi();
    function $(id) { return document.getElementById(id); }

    // ===== Markdown renderer (A2) =====
    var FENCE = String.fromCharCode(96, 96, 96);
    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderMarkdown(md) {
        var codeBlocks = [];
        var fenceRe = new RegExp(FENCE + '(\\w*)\\n([\\s\\S]*?)' + FENCE, 'g');
        var text = String(md).replace(fenceRe, function(m, lang, code) {
            codeBlocks.push({ lang: lang, code: code.replace(/\n$/, '') });
            return '\u0000CB' + (codeBlocks.length - 1) + '\u0000';
        });
        var html = escapeHtml(text);
        html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>')
                   .replace(/^## (.*)$/gm, '<h2>$1</h2>')
                   .replace(/^# (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
        html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" title="$2">$1</a>');
        html = html.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
        html = html.replace(/^---+$/gm, '<hr>');
        html = html.replace(/(^|\n)((?:[-*] .*(?:\n|$))+)/g, function(m, p, list) {
            var items = list.trim().split('\n').map(function(l) { return '<li>' + l.replace(/^[-*] /, '') + '</li>'; }).join('');
            return p + '<ul>' + items + '</ul>';
        });
        html = html.replace(/(^|\n)((?:\d+\. .*(?:\n|$))+)/g, function(m, p, list) {
            var items = list.trim().split('\n').map(function(l) { return '<li>' + l.replace(/^\d+\. /, '') + '</li>'; }).join('');
            return p + '<ol>' + items + '</ol>';
        });
        html = html.split(/\n{2,}/).map(function(block) {
            var b = block.trim();
            if (!b) return '';
            if (/^<(h\d|ul|ol|blockquote|hr)/.test(b) || /^\u0000CB\d+\u0000$/.test(b)) return b;
            return '<p>' + b.replace(/\n/g, '<br>') + '</p>';
        }).join('\n');
        html = html.replace(/\u0000CB(\d+)\u0000/g, function(m, i) {
            var cb = codeBlocks[+i];
            return '<div class="code-block">' +
                '<div class="code-header"><span class="code-lang">' + escapeHtml(cb.lang || 'code') + '</span>' +
                '<span class="code-actions">' +
                '<button class="apply-btn" data-cb="' + (+i) + '" title="اعمال این کد در فایل">اعمال</button>' +
                '<button class="copy-btn" data-cb="' + (+i) + '">کپی</button></span></div>' +
                '<pre><code>' + escapeHtml(cb.code) + '</code></pre></div>';
        });
        return html;
    }

    document.addEventListener('click', function(e) {
        var copyBtn = e.target.closest('.copy-btn');
        if (copyBtn) {
            var pre = copyBtn.closest('.code-block').querySelector('code');
            vscode.postMessage({ command: 'copyToClipboard', text: (pre || copyBtn.closest('.code-block')).textContent });
            copyBtn.textContent = 'کپی شد ✓';
            setTimeout(function() { copyBtn.textContent = 'کپی'; }, 1500);
            return;
        }
        var applyBtn = e.target.closest('.apply-btn');
        if (applyBtn) {
            var pre2 = applyBtn.closest('.code-block').querySelector('code');
            vscode.postMessage({ command: 'applyCode', text: pre2 ? pre2.textContent : '' });
        }
    });

    // ===== State =====
    var state = { currentConversation: null, conversations: [], pendingImages: [], isStreaming: false, streamingEl: null, streamingText: '', providerLabel: 'دستیار' };

    // ===== Tabs =====
    function switchTab(name) {
        var tabs = ['tabChat', 'tabHistory', 'tabSettings'];
        var views = ['viewChat', 'viewHistory', 'viewSettings'];
        for (var i = 0; i < tabs.length; i++) {
            $(tabs[i]).classList.toggle('active', tabs[i] === 'tab' + name);
            $(views[i]).classList.toggle('active', views[i] === 'view' + name);
        }
    }
    $('tabChat').addEventListener('click', function() { switchTab('Chat'); });
    $('tabHistory').addEventListener('click', function() { switchTab('History'); });
    $('tabSettings').addEventListener('click', function() { switchTab('Settings'); });

    // ===== Welcome cards (A8) =====
    var WELCOME_CARDS = [
        { icon: '📄', label: 'توضیح کد', snippetId: 'builtin.explainSelection' },
        { icon: '🐞', label: 'باگ‌یابی', snippetId: 'builtin.findBugs' },
        { icon: '✨', label: 'ریفکتور', snippetId: 'builtin.refactor' },
        { icon: '🧪', label: 'تولید تست', snippetId: 'builtin.generateTests' },
        { icon: '💬', label: 'کامنت', snippetId: 'builtin.addComments' },
        { icon: '🔍', label: 'ریویو', snippetId: 'builtin.reviewSelection' }
    ];
    function renderWelcome() {
        var el = $('welcomeCards');
        el.innerHTML = '';
        WELCOME_CARDS.forEach(function(c) {
            var card = document.createElement('button');
            card.className = 'welcome-card';
            card.innerHTML = '<span class="wc-icon">' + c.icon + '</span>' + escapeHtml(c.label);
            card.addEventListener('click', function() { vscode.postMessage({ command: 'runSnippet', snippetId: c.snippetId }); });
            el.appendChild(card);
        });
    }
    renderWelcome();

    // ===== Quick Actions (G1) =====
    function renderQuickActions(actions) {
        var el = $('quickActions');
        el.innerHTML = '';
        (actions || []).forEach(function(qa) {
            var btn = document.createElement('button');
            btn.className = 'qa-btn';
            btn.style.background = qa.color || '#4285f4';
            btn.textContent = qa.label;
            btn.title = qa.label;
            btn.addEventListener('click', function() {
                if (state.isStreaming) return;
                vscode.postMessage({ command: 'runSnippet', snippetId: qa.snippetId });
            });
            el.appendChild(btn);
        });
    }
    function renderFavorites(favorites) {
        var el = $('favoritesRow');
        el.innerHTML = '';
        (favorites || []).forEach(function(f) {
            var chip = document.createElement('button');
            chip.className = 'fav-chip';
            chip.textContent = '★ ' + f.name;
            chip.addEventListener('click', function() {
                if (state.isStreaming) return;
                vscode.postMessage({ command: 'runSnippet', snippetId: f.id });
            });
            el.appendChild(chip);
        });
    }

    // ===== Messages rendering =====
    function addMessageEl(msg, isStreaming) {
        var welcome = $('welcome');
        if (welcome) welcome.style.display = 'none';
        var el = document.createElement('div');
        el.className = 'msg ' + (msg.role === 'user' ? 'user' : 'model');
        var roleLabel = msg.role === 'user' ? 'شما' : state.providerLabel;
        var inner = '<div class="msg-header"><span class="msg-role">' + roleLabel + '</span>';
        if (!isStreaming) { inner += '<button class="msg-copy" title="کپی کل پیام">کپی</button>'; }
        inner += '</div><div class="md msg-body">' + (isStreaming ? '<span class="typing-dots"><span></span><span></span><span></span></span>' : renderMarkdown(msg.text)) + '</div>';
        if (msg.images && msg.images.length) {
            inner += '<div class="msg-images">';
            msg.images.forEach(function(img) { inner += '<img src="data:' + img.mimeType + ';base64,' + img.base64 + '" title="' + escapeHtml(img.name || '') + '">'; });
            inner += '</div>';
        }
        el.innerHTML = inner;
        var copyBtn = el.querySelector('.msg-copy');
        if (copyBtn) {
            copyBtn.addEventListener('click', function() {
                vscode.postMessage({ command: 'copyToClipboard', text: msg.text });
                copyBtn.textContent = 'کپی شد ✓';
                setTimeout(function() { copyBtn.textContent = 'کپی'; }, 1500);
            });
        }
        $('messages').appendChild(el);
        scrollBottom();
        return el;
    }
    function scrollBottom() { var area = $('chatArea'); area.scrollTop = area.scrollHeight; }
    function renderConversation(conv) {
        state.currentConversation = conv;
        $('messages').innerHTML = '';
        var hasMsgs = conv && conv.messages && conv.messages.length > 0;
        $('welcome').style.display = hasMsgs ? 'none' : '';
        if (hasMsgs) { conv.messages.forEach(function(m) { addMessageEl(m, false); }); }
        scrollBottom();
    }

    // ===== Streaming (A4) =====
    function startStreamingBubble() {
        state.isStreaming = true;
        state.streamingText = '';
        var welcome = $('welcome');
        if (welcome) welcome.style.display = 'none';
        var el = document.createElement('div');
        el.className = 'msg model';
        el.innerHTML = '<div class="msg-header"><span class="msg-role">' + state.providerLabel + '</span></div>' +
            '<div class="md msg-body"><span class="typing-dots"><span></span><span></span><span></span></span></div>';
        $('messages').appendChild(el);
        state.streamingEl = el;
        scrollBottom();
        setStreamingUI(true);
    }
    var rafPending = false;
    function appendStreamChunk(text) {
        state.streamingText += text;
        if (!rafPending && state.streamingEl) {
            rafPending = true;
            requestAnimationFrame(function() {
                rafPending = false;
                var body = state.streamingEl.querySelector('.msg-body');
                if (body) { body.innerHTML = renderMarkdown(state.streamingText); scrollBottom(); }
            });
        }
    }
    function endStreamingBubble(cancelled, finalText) {
        if (state.streamingEl) {
            var body = state.streamingEl.querySelector('.msg-body');
            if (body) {
                var text = finalText !== undefined ? finalText : state.streamingText;
                body.innerHTML = text ? renderMarkdown(text) : '<em>' + (cancelled ? 'متوقف شد.' : 'پاسخی دریافت نشد.') + '</em>';
            }
            var header = state.streamingEl.querySelector('.msg-header');
            if (header && !header.querySelector('.msg-copy')) {
                var btn = document.createElement('button');
                btn.className = 'msg-copy';
                btn.textContent = 'کپی';
                btn.addEventListener('click', function() {
                    vscode.postMessage({ command: 'copyToClipboard', text: state.streamingText });
                    btn.textContent = 'کپی شد ✓';
                    setTimeout(function() { btn.textContent = 'کپی'; }, 1500);
                });
                header.appendChild(btn);
            }
        }
        state.isStreaming = false;
        state.streamingEl = null;
        state.streamingText = '';
        setStreamingUI(false);
        scrollBottom();
    }
    function setStreamingUI(streaming) {
        $('sendBtn').style.display = streaming ? 'none' : '';
        $('stopBtn').style.display = streaming ? '' : 'none';
        $('sendBtn').disabled = streaming;
        var qas = document.querySelectorAll('.qa-btn, .fav-chip, .welcome-card');
        qas.forEach(function(b) { b.disabled = streaming; });
    }

    // ===== Composer =====
    function sendMessage() {
        if (state.isStreaming) return;
        var text = $('userPrompt').value.trim();
        if (!text && state.pendingImages.length === 0) return;
        var images = state.pendingImages.slice();
        state.pendingImages = [];
        renderImageChips();
        $('userPrompt').value = '';
        hidePreview();
        vscode.postMessage({ command: 'sendChat', text: text, images: images });
    }
    $('sendBtn').addEventListener('click', sendMessage);
    $('stopBtn').addEventListener('click', function() { vscode.postMessage({ command: 'stopProcess' }); });
    var promptEl = $('userPrompt');
    promptEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    $('previewBtn').addEventListener('click', function() {
        var pane = $('previewPane');
        if (pane.style.display === 'none') {
            pane.style.display = '';
            $('previewContent').innerHTML = renderMarkdown(promptEl.value || '_چیزی برای پیش‌نمایش نیست_');
            $('previewBtn').textContent = 'بستن پیش‌نمایش';
        } else { hidePreview(); }
    });
    promptEl.addEventListener('input', function() {
        if ($('previewPane').style.display !== 'none') { $('previewContent').innerHTML = renderMarkdown(promptEl.value); }
    });
    function hidePreview() {
        $('previewPane').style.display = 'none';
        $('previewBtn').textContent = 'پیش‌نمایش Markdown';
    }

    // ===== Images (C8/C9) =====
    $('attachBtn').addEventListener('click', function() { vscode.postMessage({ command: 'pickImage' }); });
    function addPendingImage(img) {
        if (state.pendingImages.length >= 3) { alert('حداکثر ۳ تصویر در هر پیام مجاز است.'); return; }
        state.pendingImages.push(img);
        renderImageChips();
    }
    function renderImageChips() {
        var el = $('imageChips');
        el.innerHTML = '';
        state.pendingImages.forEach(function(img, i) {
            var chip = document.createElement('div');
            chip.className = 'img-chip';
            chip.innerHTML = '<img src="data:' + img.mimeType + ';base64,' + img.base64 + '">' +
                '<span>' + escapeHtml(img.name || 'تصویر') + '</span>' +
                '<button class="remove-img" data-i="' + i + '" title="حذف">✕</button>';
            chip.querySelector('.remove-img').addEventListener('click', function() {
                state.pendingImages.splice(+this.getAttribute('data-i'), 1);
                renderImageChips();
            });
            el.appendChild(chip);
        });
    }
    document.addEventListener('paste', function(e) {
        var items = e.clipboardData && e.clipboardData.files;
        if (items && items.length) {
            for (var i = 0; i < items.length; i++) {
                var f = items[i];
                if (f.type && f.type.startsWith('image/')) {
                    e.preventDefault();
                    var reader = new FileReader();
                    reader.onload = function(ev) { addPendingImage({ base64: ev.target.result.split(',')[1], mimeType: f.type, name: 'clipboard' }); };
                    reader.readAsDataURL(f);
                }
            }
        }
    });
    document.addEventListener('dragover', function(e) { e.preventDefault(); });
    document.addEventListener('drop', function(e) {
        e.preventDefault();
        var files = e.dataTransfer && e.dataTransfer.files;
        if (!files) return;
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (f.type && f.type.startsWith('image/')) {
                (function(file) {
                    var reader = new FileReader();
                    reader.onload = function(ev) { addPendingImage({ base64: ev.target.result.split(',')[1], mimeType: file.type, name: file.name }); };
                    reader.readAsDataURL(file);
                })(f);
            }
        }
    });

    // ===== History (A5/A6) =====
    function renderConversations(convs) { state.conversations = convs || []; renderConvList(); }
    function renderConvList() {
        var el = $('convList');
        el.innerHTML = '';
        var query = ($('historySearch').value || '').trim().toLowerCase();
        var list = state.conversations.filter(function(c) { return !query || (c.title || '').toLowerCase().indexOf(query) >= 0; });
        if (list.length === 0) { el.innerHTML = '<p style="opacity:0.6; font-size:12px;">گفتگویی یافت نشد.</p>'; return; }
        list.forEach(function(c) {
            var item = document.createElement('div');
            item.className = 'conv-item' + (state.currentConversation && c.id === state.currentConversation.id ? ' active' : '');
            var date = new Date(c.updatedAt).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
            item.innerHTML = '<div class="conv-info"><div class="conv-title">' + escapeHtml(c.title) + '</div>' +
                '<div class="conv-meta">' + date + ' — ' + c.messageCount + ' پیام</div></div>' +
                '<button class="conv-del" title="حذف">✕</button>';
            item.addEventListener('click', function() { vscode.postMessage({ command: 'loadConversation', conversationId: c.id }); });
            item.querySelector('.conv-del').addEventListener('click', function(e) {
                e.stopPropagation();
                vscode.postMessage({ command: 'deleteConversation', conversationId: c.id });
            });
            el.appendChild(item);
        });
    }
    $('historySearch').addEventListener('input', renderConvList);

    // ===== Toolbar =====
    $('newChatBtn').addEventListener('click', function() { vscode.postMessage({ command: 'newChat' }); });
    $('exportBtn').addEventListener('click', function() { vscode.postMessage({ command: 'exportChat' }); });
    $('snippetPickerBtn').addEventListener('click', function() { vscode.postMessage({ command: 'openSnippetPicker' }); });
    $('writeCodeBtn').addEventListener('click', function() {
        if (state.isStreaming) return;
        if (!promptEl.value.trim()) { alert('لطفاً دستور خود را وارد کنید.'); return; }
        vscode.postMessage({ command: 'writeCode', prompt: promptEl.value, speed: parseInt($('speed').value) || 10 });
    });

    // ===== Settings =====
    $('setApiKeyBtn').addEventListener('click', function() { vscode.postMessage({ command: 'setApiKey' }); });
    $('clearApiKeyBtn').addEventListener('click', function() { vscode.postMessage({ command: 'clearApiKey' }); });
    $('providerSelect').addEventListener('change', function() { vscode.postMessage({ command: 'switchProvider', providerId: this.value }); });
    $('saveSettingsBtn').addEventListener('click', function() {
        vscode.postMessage({ command: 'saveSettings', selectedModel: $('modelSelect').value, speed: parseInt($('speed').value) || 10, baseUrl: $('baseUrlInput').value.trim() });
    });
    $('fetchModelsBtn').addEventListener('click', function() {
        $('fetchModelsBtn').textContent = 'در حال دریافت...';
        vscode.postMessage({ command: 'fetchModels' });
    });
    $('resetUsageBtn').addEventListener('click', function() { vscode.postMessage({ command: 'resetUsage' }); });

    function renderProviders(providers, activeId) {
        var sel = $('providerSelect');
        sel.innerHTML = '';
        (providers || []).forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.id; opt.textContent = p.label;
            if (p.id === activeId) opt.selected = true;
            sel.appendChild(opt);
        });
    }
    function renderModels(models, selectedModel) {
        var sel = $('modelSelect');
        sel.innerHTML = '';
        (models || []).forEach(function(name) {
            var opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            if (name === selectedModel) opt.selected = true;
            sel.appendChild(opt);
        });
    }
    function setApiKeyStatus(status) {
        var el = $('apiKeyStatus');
        if (status === 'set') { el.textContent = 'کلید API ذخیره شده است'; el.className = 'status set'; }
        else if (status === 'none') { el.textContent = 'این سرویس به کلید نیاز ندارد'; el.className = 'status set'; }
        else { el.textContent = 'کلید API تنظیم نشده است'; el.className = 'status unset'; }
    }
    function applySnapshot(s) {
        if (!s) return;
        state.providerLabel = s.providerLabel;
        $('welcomeProvider').textContent = s.providerLabel;
        $('providerSelect').value = s.providerId;
        $('baseUrlInput').value = s.baseUrl || '';
        $('apiKeyLabel').textContent = 'API Key (' + s.providerLabel + '):';
        $('setApiKeyBtn').style.display = s.needsApiKey ? '' : 'none';
        $('clearApiKeyBtn').style.display = s.needsApiKey ? '' : 'none';
        setApiKeyStatus(s.needsApiKey ? (s.apiKeyIsSet ? 'set' : 'unset') : 'none');
        renderModels(s.models, s.selectedModel);
    }
    function renderUsage(usage) {
        var el = $('usageBox');
        if (!usage || !usage.totalTokenCount) { el.textContent = 'هنوز توکنی مصرف نشده است.'; return; }
        el.textContent = 'ورودی: ' + (usage.promptTokenCount || 0).toLocaleString('fa-IR') +
            ' | خروجی: ' + (usage.candidatesTokenCount || 0).toLocaleString('fa-IR') +
            ' | مجموع: ' + (usage.totalTokenCount || 0).toLocaleString('fa-IR');
    }

    // ===== Host messages =====
    window.addEventListener('message', function(event) {
        var m = event.data;
        switch (m.command) {
            case 'initState':
                renderProviders(m.providers, m.snapshot ? m.snapshot.providerId : null);
                applySnapshot(m.snapshot);
                if (typeof m.typingSpeed === 'number') $('speed').value = m.typingSpeed;
                renderQuickActions(m.quickActions);
                renderFavorites(m.favorites);
                renderConversation(m.conversation);
                renderConversations(m.conversations);
                break;
            case 'providerSwitched': applySnapshot(m.snapshot); break;
            case 'conversationLoaded':
                renderConversation(m.conversation);
                renderConversations(m.conversations);
                switchTab('Chat');
                break;
            case 'userMessageAdded': addMessageEl(m.message, false); startStreamingBubble(); break;
            case 'streamChunk': appendStreamChunk(m.text); break;
            case 'streamEnded':
                endStreamingBubble(m.cancelled, m.cancelled ? state.streamingText : undefined);
                if (m.usage) renderUsage(m.usage);
                break;
            case 'finished': setStreamingUI(false); $('fetchModelsBtn').textContent = 'دریافت مدل‌ها'; break;
            case 'apiKeyStatus': setApiKeyStatus(m.isSet ? 'set' : 'unset'); break;
            case 'modelsFetched': $('fetchModelsBtn').textContent = 'دریافت مدل‌ها'; renderModels(m.models, m.selectedModel); break;
            case 'favoritesUpdated': renderFavorites(m.favorites); break;
            case 'snippetChosen': if (m.snippetId) vscode.postMessage({ command: 'runSnippet', snippetId: m.snippetId }); break;
            case 'imageAttached': addPendingImage({ base64: m.base64, mimeType: m.mimeType, name: m.name }); break;
            case 'insertToComposer':
                promptEl.value = (promptEl.value ? promptEl.value + '\n\n' : '') + (m.text || '');
                promptEl.focus();
                break;
        }
    });

    setStreamingUI(false);
})();
