// CONFIGURATION - Replace with your actual project details
const supabaseUrl = 'https://stczzndroorzorquszxn.supabase.co';
const supabaseKey = 'sb_publishable_7_58bmgqais4Y_EJtlO2Nw_bLgs2uUq';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

const ADMIN_EMAIL = 'text.me.md.alamin@gmail.com';

// DOM Elements
const authBtn = document.getElementById('auth-action-btn');
const authEmail = document.getElementById('auth-email');
const authPass = document.getElementById('auth-password');
const authMsg = document.getElementById('auth-msg');
let isSignUpMode = false;

// 1. AUTHENTICATION LOGIC
supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
        document.getElementById('auth-overlay').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        if (session.user.email === ADMIN_EMAIL) {
            document.getElementById('admin-fab').classList.remove('hidden');
        }
        loadNotices();
    } else {
        document.getElementById('auth-overlay').classList.remove('hidden');
        document.getElementById('main-app').classList.add('hidden');
    }
});

// Switch between Login and Signup
document.getElementById('tab-signup').onclick = () => {
    isSignUpMode = true;
    authBtn.innerText = "Create Account";
    document.getElementById('tab-signup').classList.add('active');
    document.getElementById('tab-login').classList.remove('active');
};

document.getElementById('tab-login').onclick = () => {
    isSignUpMode = false;
    authBtn.innerText = "Login";
    document.getElementById('tab-login').classList.add('active');
    document.getElementById('tab-signup').classList.remove('active');
};

authBtn.onclick = async () => {
    const email = authEmail.value;
    const password = authPass.value;
    authMsg.innerText = "Processing...";

    if (isSignUpMode) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) authMsg.innerText = error.message;
        else alert("Success! You can now log in.");
    } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) authMsg.innerText = error.message;
    }
};

document.getElementById('logout-btn').onclick = () => supabase.auth.signOut();

// 2. FEED LOGIC
async function loadNotices() {
    const { data, error } = await supabase.from('notices').select('*').order('created_at', { ascending: false });
    const list = document.getElementById('notices-list');
    
    if (data) {
        list.innerHTML = data.map(n => `
            <div class="notice-card">
                <h3>${n.title || 'Announcement'}</h3>
                <p>${n.content}</p>
                ${n.image_url ? `<img src="${n.image_url}" loading="lazy">` : ''}
                <small>${new Date(n.created_at).toLocaleString()}</small>
            </div>
        `).join('');
    }
}

// 3. ADMIN POSTING LOGIC
function toggleModal() {
    document.getElementById('admin-modal').classList.toggle('hidden');
}

document.getElementById('submit-post').onclick = async () => {
    const title = document.getElementById('post-title').value;
    const content = document.getElementById('post-content').value;
    const file = document.getElementById('post-image').files[0];
    const btn = document.getElementById('submit-post');
    
    if (!content) return alert("Content is required");
    btn.disabled = true;
    btn.innerText = "Uploading...";

    let imageUrl = null;
    if (file) {
        const fileName = `${Date.now()}_${file.name}`;
        const { data } = await supabase.storage.from('notice-images').upload(fileName, file);
        if (data) {
            const { data: urlData } = supabase.storage.from('notice-images').getPublicUrl(fileName);
            imageUrl = urlData.publicUrl;
        }
    }

    const { error } = await supabase.from('notices').insert([{ title, content, image_url: imageUrl }]);
    
    btn.disabled = false;
    btn.innerText = "Post Notice";

    if (!error) {
        toggleModal();
        loadNotices();
        document.getElementById('post-title').value = '';
        document.getElementById('post-content').value = '';
    } else {
        alert("Post failed: " + error.message);
    }
};
