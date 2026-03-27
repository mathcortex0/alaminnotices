document.addEventListener('DOMContentLoaded', () => {
    // 1. CONFIGURATION
    const supabaseUrl = 'https://stczzndroorzorquszxn.supabase.co';
    const supabaseKey = 'sb_publishable_7_58bmgqais4Y_EJtlO2Nw_bLgs2uUq';
    const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

    const ADMIN_EMAIL = 'text.me.md.alamin@gmail.com';

    // Elements
    const authBtn = document.getElementById('auth-action-btn');
    const authEmail = document.getElementById('auth-email');
    const authPass = document.getElementById('auth-password');
    const authMsg = document.getElementById('auth-msg');
    const adminFab = document.getElementById('admin-fab');
    let isSignUpMode = false;

    // 2. AUTHENTICATION
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session) {
            document.getElementById('auth-overlay').classList.add('hidden');
            document.getElementById('main-app').classList.remove('hidden');
            if (session.user.email === ADMIN_EMAIL) adminFab.classList.remove('hidden');
            loadNotices();
        } else {
            document.getElementById('auth-overlay').classList.remove('hidden');
            document.getElementById('main-app').classList.add('hidden');
        }
    });

    // Toggle Login/Signup
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

    // Action Button
    authBtn.onclick = async () => {
        const email = authEmail.value;
        const password = authPass.value;
        if(!email || !password) return alert("Fill all fields");

        authMsg.innerText = "Processing...";
        if (isSignUpMode) {
            const { error } = await supabaseClient.auth.signUp({ email, password });
            if (error) authMsg.innerText = error.message;
            else alert("Account created! Log in now.");
        } else {
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) authMsg.innerText = error.message;
        }
    };

    document.getElementById('logout-btn').onclick = () => supabaseClient.auth.signOut();

    // 3. FEED LOGIC
    async function loadNotices() {
        const { data } = await supabaseClient.from('notices').select('*').order('created_at', { ascending: false });
        const list = document.getElementById('notices-list');
        list.innerHTML = data ? data.map(n => `
            <div class="notice-card">
                <h3>${n.title || 'Update'}</h3>
                <p>${n.content}</p>
                ${n.image_url ? `<img src="${n.image_url}">` : ''}
                <small>${new Date(n.created_at).toLocaleDateString()}</small>
            </div>
        `).join('') : '<p>No notices yet.</p>';
    }

    // 4. ADMIN MODAL LOGIC
    adminFab.onclick = () => document.getElementById('admin-modal').classList.remove('hidden');
    document.getElementById('close-modal').onclick = () => document.getElementById('admin-modal').classList.add('hidden');

    document.getElementById('submit-post').onclick = async () => {
        const title = document.getElementById('post-title').value;
        const content = document.getElementById('post-content').value;
        const file = document.getElementById('post-image').files[0];
        const btn = document.getElementById('submit-post');

        if(!content) return alert("Write something!");
        btn.disabled = true;
        btn.innerText = "Uploading...";

        let imageUrl = null;
        if (file) {
            const fileName = `${Date.now()}_${file.name}`;
            const { data } = await supabaseClient.storage.from('notice-images').upload(fileName, file);
            if (data) imageUrl = supabaseClient.storage.from('notice-images').getPublicUrl(fileName).data.publicUrl;
        }

        const { error } = await supabaseClient.from('notices').insert([{ title, content, image_url: imageUrl }]);
        
        btn.disabled = false;
        btn.innerText = "Post Notice";
        if (!error) {
            document.getElementById('admin-modal').classList.add('hidden');
            loadNotices();
        } else {
            alert(error.message);
        }
    };
});
