// Script Node.js pour appliquer la configuration MegaLLM
const { Client } = require('./server/node_modules/pg');

const connectionString = 'postgres://postgres:YOMFBjzOHTAZtfogMLYGOvp3jJTBUW7zXIQH7HFHPWC4uzW4muObmDgoNXMhZtOM@62.169.27.8:5555/dyad';

const sql = `
-- Configuration de MegaLLM
DELETE FROM language_models WHERE custom_provider_id = 'megallm';
DELETE FROM language_model_providers WHERE id = 'megallm';

INSERT INTO language_model_providers (id, name, api_base_url, env_var_name, api_key, created_at, updated_at)
VALUES (
  'megallm',
  'MegaLLM',
  'https://ai.megallm.io/v1',
  'MEGALLM_API_KEY',
  'sk-mega-2b5b517612547dff2676985fcfb2b3936d10160688350730a6f451745d210595',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  api_base_url = EXCLUDED.api_base_url,
  env_var_name = EXCLUDED.env_var_name,
  api_key = EXCLUDED.api_key,
  updated_at = NOW();

INSERT INTO language_models (display_name, api_name, custom_provider_id, description, max_output_tokens, context_window, created_at, updated_at)
VALUES (
  'OpenAI GPT OSS 20B',
  'openai-gpt-oss-20b',
  'megallm',
  'Open source GPT model with 20B parameters from MegaLLM',
  4096,
  8192,
  NOW(),
  NOW()
);

INSERT INTO system_settings (key, value, description, created_at, updated_at)
VALUES (
  'defaultModel',
  'openai-gpt-oss-20b',
  'Default AI model for new chats',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

SELECT 'MegaLLM Provider:' as info, * FROM language_model_providers WHERE id = 'megallm';
SELECT 'MegaLLM Models:' as info, * FROM language_models WHERE custom_provider_id = 'megallm';
SELECT 'Default Model Setting:' as info, * FROM system_settings WHERE key = 'defaultModel';
`;

async function configureMegaLLM() {
    const client = new Client({ connectionString });

    try {
        console.log('🔌 Connexion à la base de données...');
        await client.connect();
        console.log('✅ Connecté!');

        console.log('⚙️  Application de la configuration MegaLLM...');
        const result = await client.query(sql);

        console.log('\n📊 Résultats:');
        if (Array.isArray(result)) {
            result.forEach((res, index) => {
                if (res.rows && res.rows.length > 0) {
                    console.log(`\nRequête ${index + 1}:`);
                    console.table(res.rows);
                }
            });
        } else if (result.rows) {
            console.table(result.rows);
        }

        console.log('\n✅ Configuration MegaLLM appliquée avec succès!');
        console.log('🎉 Le modèle openai-gpt-oss-20b est maintenant le modèle par défaut');

    } catch (error) {
        console.error('❌ Erreur:', error.message);
        process.exit(1);
    } finally {
        await client.end();
        console.log('🔌 Déconnexion de la base de données');
    }
}

configureMegaLLM();
