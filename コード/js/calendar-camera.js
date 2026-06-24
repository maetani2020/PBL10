// calendar-camera.js
// Custom Video Camera controls

import { 
  currentAttachments, 
  setCurrentAttachments, 
  showToast 
} from './calendar-state.js';

// We import UI updates from calendar-ai.js
import { 
  renderAttachmentsCarousel, 
  validateSendButton 
} from './calendar-ai.js';

export const cameraModal = document.getElementById("cameraModal");
export const cameraVideo = document.getElementById("cameraVideo");
export const shutterBtn = document.getElementById("shutterBtn");
export const closeCameraModalBtn = document.getElementById("closeCameraModalBtn");

let cameraStream = null;

export async function openCameraModal() {
  cameraModal.style.display = "flex";
  
  const videoContainer = document.getElementById("cameraVideoContainer");
  const shutter = document.getElementById("shutterBtn");

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("⚠️ カメラ機能はローカルサーバー（Live Server等）経由が必要です。");
    if (shutter) shutter.style.display = "none";
    if (videoContainer) {
      videoContainer.innerHTML = `
        <div style="padding: 20px; text-align: center; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 10px; font-family: sans-serif;">
          <span class="material-icons" style="font-size: 48px; color: #ffcc00;">warning</span>
          <p style="font-size: 13.5px; font-weight: bold; margin: 0; line-height: 1.4;">セキュリティ制限のため、file:// URI ではカメラを起動できません。</p>
          <p style="font-size: 11px; color: #8e8e93; margin: 0; line-height: 1.4;">VSCodeのLive Serverなどのローカルサーバーを使用するか、HTTPS環境下で実行してください。</p>
        </div>
      `;
    }
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    const video = document.getElementById("cameraVideo");
    if (video) {
      video.srcObject = stream;
      video.play();
    }
    cameraStream = stream;
  } catch (err) {
    console.error("Camera startup failed: ", err);
    showToast("カメラの起動に失敗しました 📷");
    closeCameraModal();
  }
}

export function closeCameraModal() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  
  const videoContainer = document.getElementById("cameraVideoContainer");
  if (videoContainer) {
    videoContainer.innerHTML = `<video id="cameraVideo" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>`;
  }
  
  const shutter = document.getElementById("shutterBtn");
  if (shutter) {
    shutter.style.display = "flex";
  }
  
  cameraModal.style.display = "none";
}

export function capturePhotoFromCamera() {
  const video = document.getElementById("cameraVideo");
  if (!cameraStream || !video) return;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const compressedBase64 = canvas.toDataURL("image/jpeg", 0.75);
  const id = "attach_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);

  const attachments = [...currentAttachments];
  attachments.push({
    id: id,
    name: `camera_capture_${Date.now()}.jpg`,
    base64Payload: compressedBase64.split(",")[1],
    fullBase64: compressedBase64,
    description: ""
  });
  setCurrentAttachments(attachments);

  renderAttachmentsCarousel();
  validateSendButton();
  closeCameraModal();
  showToast("写真を撮影しました 📸");
}

// Attach attachment removal and description updates to global window scope so HTML elements can call them
window.removeAttachment = function(id) {
  const attachments = currentAttachments.filter(item => item.id !== id);
  setCurrentAttachments(attachments);
  renderAttachmentsCarousel();
  validateSendButton();
};

window.updateAttachmentDesc = function(id, text) {
  const item = currentAttachments.find(attach => attach.id === id);
  if (item) {
    item.description = text;
  }
};
