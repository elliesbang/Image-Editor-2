document.addEventListener('DOMContentLoaded', () => {
  const isLoggedIn = localStorage.getItem('userLoggedIn') === 'true';
  if (!isLoggedIn) {
    window.location.replace('./index.html');
    return;
  }

  const email = localStorage.getItem('userEmail') || '게스트';
  const loginAt = localStorage.getItem('userLoginAt');

  const emailDisplay = document.querySelector('[data-role="user-email"]');
  const loginAtDisplay = document.querySelector('[data-role="user-login-at"]');

  if (emailDisplay) {
    emailDisplay.textContent = email;
  }

  if (loginAtDisplay) {
    if (loginAt) {
      const formatted = new Date(loginAt).toLocaleString('ko-KR', {
        hour12: false,
      });
      loginAtDisplay.textContent = formatted;
    } else {
      loginAtDisplay.textContent = '-';
    }
  }

  const logoutButton = document.querySelector('[data-role="user-logout"]');
  if (logoutButton) {
    logoutButton.addEventListener('click', () => {
      localStorage.removeItem('userLoggedIn');
      localStorage.removeItem('userEmail');
      localStorage.removeItem('userLoginAt');
      window.location.href = './index.html';
    });
  }
});
