document.addEventListener('DOMContentLoaded', () => {
  const isLoggedIn = localStorage.getItem('adminLoggedIn') === 'true';
  if (!isLoggedIn) {
    window.location.replace('./index.html');
    return;
  }

  const email = localStorage.getItem('adminEmail') || '관리자';
  const emailDisplay = document.querySelector('[data-role="admin-email"]');
  if (emailDisplay) {
    emailDisplay.textContent = email;
  }

  const logoutButton = document.querySelector('[data-role="admin-logout"]');
  if (logoutButton) {
    logoutButton.addEventListener('click', () => {
      localStorage.removeItem('adminLoggedIn');
      localStorage.removeItem('adminEmail');
      window.location.href = './index.html';
    });
  }
});
