const supabaseUrl = 'https://stczzndroorzorquszxn.supabase.co';
const supabaseKey = 'sb_publishable_7_58bmgqais4Y_EJtlO2Nw_bLgs2uUq';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

const ADMIN_EMAIL = 'text.me.md.alamin@gmail.com';

// 1. Auth Listeners
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

document.getElementById('login-btn').onclick = () => supabase.auth.signInWithOAuth({ provider: 'google' });
document.getElementById('logout-btn').onclick = () => supabase.auth.signOut();

// 2. Load Notices
async function loadNotices() {
    const { data, error } = await supabase
        .from('notices')
        .select('*')
        .order('created_at', { ascending: false });

    const list = document.getElementById('notices-list');
    list.innerHTML = data.map(n => `
        <div class="notice-card">
            <h3>${n.title}</h3>
            <p>${n.content}</p>
            ${n.image_url ? `<img src="${n.image_url}">` : ''}
            <small>${new Date(n.created_at).toLocaleDateString()}</small>
        </div>
    `).join('');
}

// 3. Admin Functionality
function toggleModal() {
    document.getElementById('admin-modal').classList.toggle('hidden');
}

document.getElementById('submit-post').onclick = async () => {
    const title = document.getElementById('post-title').value;
    const content = document.getElementById('post-content').value;
    const file = document.getElementById('post-image').files[0];
    let imageUrl = null;

    if (file) {
        const fileName = `${Date.now()}_${file.name}`;
        const { data, error } = await supabase.storage
            .from('notice-images')
            .upload(fileName, file);
        
        if (data) {
            const { data: urlData } = supabase.storage.from('notice-images').getPublicUrl(fileName);
            imageUrl = urlData.publicUrl;
        }
    }

    const { error } = await supabase.from('notices').insert([{ title, content, image_url: imageUrl }]);
    
    if (!error) {
        toggleModal();
        loadNotices();
    } else {
        alert("Error posting notice: " + error.message);
    }
};
