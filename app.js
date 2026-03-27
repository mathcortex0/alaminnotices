// 1. PROJECT CONFIGURATION
// Replace these with your actual keys from Supabase Settings > API
const supabaseUrl = 'https://stczzndroorzorquszxn.supabase.co';
const supabaseKey = 'sb_publishable_7_58bmgqais4Y_EJtlO2Nw_bLgs2uUq';

// Initialize Supabase
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

const ADMIN_EMAIL = 'text.me.md.alamin@gmail.com';

// 2. WAIT FOR PAGE TO LOAD
window.onload = () => {
    console.log("Alamin Notices: System Loaded");

    // Elements
    const authBtn = document.getElementById('auth-action-btn');
    const authEmail = document.getElementById('auth-email');
    const authPass = document.getElementById('auth-password');
    const authMsg = document.getElementById('auth-msg');
    
    const loginTab = document.getElementById('tab-login');
    const signupTab = document.getElementById('tab-signup');
    
    const adminFab = document.getElementById('admin-fab');
    const logoutBtn = document.getElementById('logout-btn');
    
    let isSignUpMode = false;

    // 3. AUTHENTICATION STATE TRACKER
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session) {
            console.log("User is logged in:", session.user.email);
            document.getElementById('auth-overlay').classList.add('hidden');
            document.getElementById('main-app').classList.remove('hidden');
            
            // Show Admin Button only if it's YOU
            if (session.user.email === ADMIN_EMAIL) {
                adminFab.classList.remove('hidden');
            }
            loadNotices();
        } else {
            console.log("No active session.");
            document.getElementById('auth-overlay').classList.remove('hidden');
            document.getElementById('main-app').classList.add('hidden');
        }
    });

    // 4. TAB SWITCHING LOGIC
    loginTab.onclick = () => {
        isSignUpMode = false;
        authBtn.innerText = "Login";
        loginTab.classList.add('active');
        signupTab.classList.remove('active');
    };

    signupTab.onclick = () => {
        isSignUpMode = true;
        authBtn.innerText = "Create Account";
        signupTab.classList.add('active');
        loginTab.classList.remove('active');
    };

    // 5. LOGIN / SIGNUP ACTION
    authBtn.onclick = async () => {
        const email = authEmail.value.trim();
        const password = authPass.value.trim();

        if (!email || !password) {
            alert("Please enter both email and password.");
            return;
        }

        authBtn.disabled = true;
        authMsg.innerText = "Processing... please wait.";

        if (isSignUpMode) {
            // SIGN UP
            const { data, error } = await supabaseClient.auth.signUp({ email, password });
            if (error) {
                authMsg.innerText = "Error: " + error.message;
            } else {
                alert("Account created! You can now log in.");
                isSignUpMode = false;
                authBtn.innerText = "Login";
            }
        } else {
            // LOGIN
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) {
                authMsg.innerText = "Login Failed: " + error.message;
            }
        }
        authBtn.disabled = false;
    };

    // 6. LOGOUT
    logoutBtn.onclick = async () => {
        await supabaseClient.auth.signOut();
        location.reload(); // Refresh to clear data
    };

    // 7. LOAD NOTICES FROM DATABASE
    async function loadNotices() {
        const { data, error } = await supabaseClient
            .from('notices')
            .select('*')
            .order('created_at', { ascending: false });

        const list = document.getElementById('notices-list');
        
        if (error) {
            console.error("Database Error:", error.message);
            list.innerHTML = `<p style="color:red">Failed to load notices: ${error.message}</p>`;
            return;
        }

        if (data && data.length > 0) {
            list.innerHTML = data.map(n => `
                <div class="notice-card">
                    <h3>${n.title || 'Announcement'}</h3>
                    <p>${n.content}</p>
                    ${n.image_url ? `<img src="${n.image_url}" alt="notice-img">` : ''}
                    <small>${new Date(n.created_at).toLocaleString()}</small>
                </div>
            `).join('');
        } else {
            list.innerHTML = '<p style="text-align:center; opacity:0.5;">No announcements yet.</p>';
        }
    }

    // 8. ADMIN POST MODAL LOGIC
    if (adminFab) {
        adminFab.onclick = () => {
            document.getElementById('admin-modal').classList.remove('hidden');
        };
    }

    const closeModal = document.getElementById('close-modal');
    if (closeModal) {
        closeModal.onclick = () => {
            document.getElementById('admin-modal').classList.add('hidden');
        };
    }

    // 9. SUBMIT NEW NOTICE
    const submitBtn = document.getElementById('submit-post');
    submitBtn.onclick = async () => {
        const title = document.getElementById('post-title').value;
        const content = document.getElementById('post-content').value;
        const file = document.getElementById('post-image').files[0];

        if (!content) {
            alert("Content is required!");
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerText = "Uploading...";

        let imageUrl = null;

        // Upload Image if exists
        if (file) {
            const fileName = `public/${Date.now()}_${file.name}`;
            const { data, error: uploadError } = await supabaseClient.storage
                .from('notice-images')
                .upload(fileName, file);
            
            if (data) {
                const { data: urlData } = supabaseClient.storage.from('notice-images').getPublicUrl(fileName);
                imageUrl = urlData.publicUrl;
            } else {
                console.error("Upload Error:", uploadError);
            }
        }

        // Insert into Table
        const { error: insertError } = await supabaseClient
            .from('notices')
            .insert([{ title, content, image_url: imageUrl }]);

        if (insertError) {
            alert("Database Error: " + insertError.message);
        } else {
            alert("Notice posted successfully!");
            document.getElementById('admin-modal').classList.add('hidden');
            loadNotices();
            // Clear inputs
            document.getElementById('post-title').value = '';
            document.getElementById('post-content').value = '';
            document.getElementById('post-image').value = '';
        }
        
        submitBtn.disabled = false;
        submitBtn.innerText = "Post Notice";
    };
};
