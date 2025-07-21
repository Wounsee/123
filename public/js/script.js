document.addEventListener('DOMContentLoaded', function() {
    // Элементы интерфейса
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const messagesContainer = document.getElementById('messages-container');
    const chatItems = document.querySelectorAll('.chat-item');
    const currentChatName = document.getElementById('current-chat-name');
    const fileUpload = document.getElementById('file-upload');
    const inviteModal = document.getElementById('invite-modal');
    const inviteChatBtn = document.getElementById('invite-chat-btn');
    const closeModal = document.querySelector('.close-modal');
    const inviteCodeInput = document.getElementById('invite-code');
    const joinChatBtn = document.getElementById('join-chat-btn');
    const generateInviteBtn = document.getElementById('generate-invite-btn');
    const maxUsesInput = document.getElementById('max-uses');
    const generatedCodeDiv = document.getElementById('generated-code');
    const banModal = document.getElementById('ban-modal');
    const submitAppealBtn = document.getElementById('submit-appeal');
    const replyPreview = document.getElementById('reply-preview');
    
    // Состояние приложения
    let currentChat = 'general';
    let username = '';
    let isAdmin = false;
    let socket;
    let replyingTo = null;
    let bannedUntil = null;
    
    // Инициализация
    function init() {
        console.log('Initializing...'); // Добавьте это
        username = '<%username %>';
        isAdmin = '<%{isAdmin %>';
        console.log('User:', username, 'Admin:', isAdmin); // И это
        connectWebSocket();
        loadChatHistory(currentChat);
        setupEventListeners();
        checkBanStatus();
}
    // Подключение к WebSocket
    function connectWebSocket() {
    socket = new WebSocket(`ws://${window.location.host}`);
    
    socket.onopen = function() {
        console.log('WebSocket connection established');
        // Теперь соединение точно установлено
        loadChatHistory(currentChat);
        
        // Отправляем данные аутентификации
        socket.send(JSON.stringify({
            type: 'auth',
            username: username,
            isAdmin: isAdmin
        }));
    };
        
        socket.onmessage = function(event) {
            const data = JSON.parse(event.data);
            
            switch(data.type) {
                case 'message':
                    handleNewMessage(data);
                    break;
                case 'chat_history':
                    displayChatHistory(data.messages);
                    break;
                case 'user_banned':
                    showBanModal(data);
                    break;
                case 'invite_code':
                    showGeneratedCode(data.code);
                    break;
                case 'notification':
                    showNotification(data.message);
                    break;
                case 'error':
                    showError(data.message);
                    break;
            }
        };
        
        socket.onclose = function() {
            console.log('WebSocket connection closed');
            setTimeout(connectWebSocket, 5000);
        };
    }
    
    // Настройка обработчиков событий
    function setupEventListeners() {
        console.log('Setting up event listeners...'); // Добавьте это
        // Отправка сообщения
        sendButton.addEventListener('click', sendMessage);
        console.log('Send button clicked'); // Добавьте это
        messageInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
        
        // Выбор чата
        chatItems.forEach(item => {
            item.addEventListener('click', function() {
                chatItems.forEach(i => i.classList.remove('active'));
                this.classList.add('active');
                currentChat = this.getAttribute('data-chat');
                currentChatName.textContent = this.textContent;
                loadChatHistory(currentChat);
            });
        });
        
        // Загрузка файла
        fileUpload.addEventListener('change', async function() {
    if (!this.files || !this.files[0]) return;

    const file = this.files[0];
    if (file.size > 5 * 1024 * 1024) {
        showError('File size should be less than 5MB');
        return;
    }

    showNotification('Compressing and uploading image...');

    try {
        // Создаем временный URL для предпросмотра
        const previewUrl = URL.createObjectURL(file);
        
        // Сжимаем изображение
        const compressedBlob = await compressImage(file);
        
        // Отправляем на сервер
        const formData = new FormData();
        formData.append('image', compressedBlob, file.name);

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        
        if (data.success) {
            showNotification('Image uploaded. Sending message...');
            // Отправляем сообщение с изображением
            sendMessage(data.imageUrl, true);
        } else {
            showError(data.message || 'Failed to upload image');
        }
    } catch (error) {
        console.error('Upload error:', error);
        showError('Error uploading image');
    } finally {
        this.value = ''; // Сбрасываем input file
    }
});

async function compressImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async function(e) {
            const img = new Image();
            img.src = e.target.result;
            
            img.onload = async function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Ресайз до 720p
                const maxWidth = 1280;
                const maxHeight = 720;
                let width = img.width;
                let height = img.height;
                
                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                
                canvas.toBlob(resolve, 'image/jpeg', 0.8);
            };
        };
        reader.readAsDataURL(file);
    });
}
        
        // Модальное окно приглашения
        inviteChatBtn.addEventListener('click', () => inviteModal.style.display = 'flex');
        closeModal.addEventListener('click', () => inviteModal.style.display = 'none');
        joinChatBtn.addEventListener('click', joinChatByCode);
        
        if (generateInviteBtn) {
            generateInviteBtn.addEventListener('click', generateInviteCode);
        }
        
        // Обработка бана
        if (submitAppealBtn) {
            submitAppealBtn.addEventListener('click', submitAppeal);
        }
        
        // Клик вне модального окна
        window.addEventListener('click', function(event) {
            if (event.target === inviteModal) {
                inviteModal.style.display = 'none';
            }
            if (event.target === banModal) {
                banModal.style.display = 'none';
            }
        });
    }
    let lastMessageTime = 0;
    // Отправка сообщения
    function sendMessage(imageUrl = null, isImage = false) {
     const now = Date.now();
     const text = messageInput.value.trim();
    if (!text) {
        showError('Message cannot be empty');
        return;
    }
    if (now - lastMessageTime < 2000) {
        showError(`Please wait ${Math.ceil((2000 - (now - lastMessageTime))/1000)} seconds`);
        return;
    }
    if (!text) return;

    lastMessageTime = now;
    // Проверяем готовность соединения
    if (socket.readyState !== WebSocket.OPEN) {
        console.error('WebSocket is not open. Current state:', socket.readyState);
        showError('Connection is not ready. Please wait...');
        return;
    }

    const message = {
        type: 'message',
        chat: currentChat,
        text: text,
        username: username,
        isAdmin: isAdmin,
        timestamp: Date.now(),
        replyTo: replyingTo,
        isImage: isImage,
        imageUrl: imageUrl
    };

    console.log('Sending message:', message); // Логируем отправляемое сообщение

    try {
        socket.send(JSON.stringify(message));
        
        if (!isImage) {
            messageInput.value = '';
        }
        
        if (replyingTo) {
            replyingTo = null;
            replyPreview.style.display = 'none';
        }

        // Для текстовых сообщений добавляем локальное отображение
        if (!isImage) {
            message.isCurrentUser = true;
            displayMessage(message);
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showError('Failed to send message');
    }
}
    // Обработка нового сообщения
    function handleNewMessage(data) {
        // Проверяем, не наше ли это сообщение (чтобы не дублировать)
        if (data.username === username && !data.isCurrentUser) return;
        
        displayMessage(data);
    }
    
    // Отображение сообщения
    function displayMessage(data) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${data.username === username ? 'user' : 'other'} ${data.isAdmin ? 'admin' : ''}`;
        
        let messageHtml = `
            <div class="message-info">
                <span class="sender">${data.isAdmin ? '👑 ' : ''}${data.username}</span>
                <span class="time">${formatTime(data.timestamp)}</span>
            </div>
        `;
        
        if (data.replyTo) {
            messageHtml += `
                <div class="reply-to">
                    Replying to ${data.replyTo.username}: ${data.replyTo.text.substring(0, 30)}${data.replyTo.text.length > 30 ? '...' : ''}
                </div>
            `;
        }
        
        if (data.isImage) {
            messageHtml += `
                <div class="message-text">
                    <img src="${data.imageUrl}" class="message-image" alt="Uploaded image">
                </div>
            `;
        } else if (data.text) {
            messageHtml += `
                <div class="message-text">${data.text}</div>
            `;
        }
        
        // Кнопка удаления для админа или своего сообщения
        if (isAdmin || data.username === username) {
            messageHtml += `
                <span class="delete-message" data-id="${data.id}">✕</span>
            `;
        }
        
        messageDiv.innerHTML = messageHtml;
        messagesContainer.appendChild(messageDiv);
        
        // Прокрутка вниз
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Обработчик ответа на сообщение
        if (data.username !== username) {
            messageDiv.addEventListener('click', function() {
                replyingTo = {
                    id: data.id,
                    username: data.username,
                    text: data.text
                };
                
                replyPreview.innerHTML = `
                    Replying to ${data.username}: ${data.text.substring(0, 30)}${data.text.length > 30 ? '...' : ''}
                    <span class="cancel-reply">✕</span>
                `;
                
                replyPreview.style.display = 'block';
                
                // Отмена ответа
                replyPreview.querySelector('.cancel-reply').addEventListener('click', function(e) {
                    e.stopPropagation();
                    replyingTo = null;
                    replyPreview.style.display = 'none';
                });
            });
        }
        
        // Обработчик удаления сообщения
        const deleteBtn = messageDiv.querySelector('.delete-message');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                deleteMessage(data.id);
            });
        }
    }
    
    // Удаление сообщения
    function deleteMessage(messageId) {
        socket.send(JSON.stringify({
            type: 'delete_message',
            messageId: messageId,
            chat: currentChat
        }));
    }
    
    // Загрузка истории чата
    function loadChatHistory(chat) {
    // Проверяем состояние соединения
    if (socket.readyState !== WebSocket.OPEN) {
        console.log('Waiting for WebSocket connection...');
        return;
    }
    
    socket.send(JSON.stringify({
        type: 'get_history',
        chat: chat
    }));
}
    
    // Отображение истории чата
    function displayChatHistory(messages) {
        messagesContainer.innerHTML = '';
        messages.forEach(msg => {
            msg.isCurrentUser = msg.username === username;
            displayMessage(msg);
        });
        
        // Прокрутка вниз
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    // Присоединение к чату по коду
    function joinChatByCode() {
        const code = inviteCodeInput.value.trim();
        if (!code) return;
        
        socket.send(JSON.stringify({
            type: 'join_chat',
            code: code
        }));
        
        inviteCodeInput.value = '';
        inviteModal.style.display = 'none';
    }
    
    // Генерация кода приглашения (для Wounsee)
    function generateInviteCode() {
    if (username !== 'Wounsee') {
        showError('Only Wounsee can generate invite codes');
        return;
    }

    const maxUses = parseInt(maxUsesInput.value) || 1;
    
    socket.send(JSON.stringify({
        type: 'generate_invite',
        maxUses: maxUses
    }));
}
    
    // Показ сгенерированного кода
    function showGeneratedCode(code) {
        generatedCodeDiv.textContent = code;
    }
    
    // Проверка статуса бана
    function checkBanStatus() {
        // Здесь должна быть проверка на сервере
        // Для демонстрации просто возвращаем false
        return false;
    }
    
    // Показ модального окна бана
    function showBanModal(data) {
        document.getElementById('ban-moderator').textContent = data.moderator;
        document.getElementById('ban-reason').textContent = data.reason;
        document.getElementById('ban-duration').textContent = data.duration;
        
        bannedUntil = Date.now() + data.duration * 24 * 60 * 60 * 1000;
        banModal.style.display = 'flex';
    }
    
    // Отправка апелляции
    function submitAppeal() {
        const appealText = document.getElementById('appeal-text').value.trim();
        if (!appealText) return;
        
        socket.send(JSON.stringify({
            type: 'submit_appeal',
            appeal: appealText
        }));
        
        showNotification('Your appeal has been submitted');
        banModal.style.display = 'none';
    }
    
    // Форматирование времени
    function formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // Показ уведомления
    function showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
    
    // Показ ошибки
    function showError(message) {
        const error = document.createElement('div');
        error.className = 'notification error';
        error.textContent = message;
        document.body.appendChild(error);
        
        setTimeout(() => {
            error.remove();
        }, 3000);
    }
    
    // Инициализация приложения
    init();
});