// Login page JavaScript

document.addEventListener('DOMContentLoaded', () => {
    const phoneNumberInput = document.getElementById('phone-number');
    const loginButton = document.getElementById('login-button');
    const randomLoginButton = document.getElementById('random-login-button');
    const phoneError = document.getElementById('phone-error');
    const loginStatus = document.getElementById('login-status');

    // Check if user is already logged in
    const userData = localStorage.getItem('userData');
    if (userData) {
        // User is already logged in, redirect to main app
        window.location.href = '/index.html';
        return;
    }

    // Add event listeners
    loginButton.addEventListener('click', handleLogin);
    randomLoginButton.addEventListener('click', handleRandomLogin);
    phoneNumberInput.addEventListener('input', validatePhoneNumber);

    // Validate phone number on input
    function validatePhoneNumber() {
        const phoneNumber = phoneNumberInput.value.trim();
        
        // Clear previous error
        phoneError.textContent = '';
        
        // Validate phone number format (10 digits)
        if (phoneNumber && !/^\d{10}$/.test(phoneNumber)) {
            phoneError.textContent = 'Please enter a valid 10-digit phone number';
            return false;
        }
        
        return true;
    }

    // Handle login button click
    async function handleLogin() {
        // Validate phone number
        if (!validatePhoneNumber()) {
            return;
        }

        const phoneNumber = phoneNumberInput.value.trim();
        
        // Show loading status
        loginStatus.textContent = 'Logging in...';
        loginStatus.className = '';
        loginStatus.style.display = 'block';
        
        try {
            // Call login API
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phoneNumber })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message || 'Login failed');
            }
            
            if (!data.userData) {
                // No user found with this phone number
                loginStatus.textContent = 'No account found with this phone number';
                loginStatus.className = 'error';
                return;
            }
            
            // Store user data in localStorage
            localStorage.setItem('userData', JSON.stringify(data.userData));
            
            // Show success message
            loginStatus.textContent = 'Login successful! Redirecting...';
            loginStatus.className = 'success';
            
            // Redirect to main app after a short delay
            setTimeout(() => {
                window.location.href = '/index.html';
            }, 1000);
            
        } catch (error) {
            console.error('Login error:', error);
            
            // Show error message
            loginStatus.textContent = error.message || 'Failed to login. Please try again.';
            loginStatus.className = 'error';
        }
    }

    // Handle random login button click
    async function handleRandomLogin() {
        // Show loading status
        loginStatus.textContent = 'Logging in with random user...';
        loginStatus.className = '';
        loginStatus.style.display = 'block';
        
        try {
            // Call random login API
            const response = await fetch('/api/login/random', {
                method: 'POST'
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message || 'Random login failed');
            }
            
            // Store user data in localStorage
            localStorage.setItem('userData', JSON.stringify(data.userData));
            
            // Show success message
            loginStatus.textContent = 'Login successful with random user! Redirecting...';
            loginStatus.className = 'success';
            
            // Redirect to main app after a short delay
            setTimeout(() => {
                window.location.href = '/index.html';
            }, 1000);
            
        } catch (error) {
            console.error('Random login error:', error);
            
            // Show error message
            loginStatus.textContent = error.message || 'Failed to login with random user. Please try again.';
            loginStatus.className = 'error';
        }
    }
}); 