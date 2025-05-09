import { useSettings } from "@/hooks/useSettings";
import { useState } from 'react';
import {Button} from "@/components/ui/button.tsx";
import {Input} from "@/components/ui/input.tsx";
import { LocalModelProvider } from "@/constants/models.ts";

export const LocalModelURLInput = ({ provider }: { provider: LocalModelProvider }) => {
    const {settings, updateSettings} = useSettings();
    const [baseURL, setBaseURL] = useState(settings?.providerSettings[provider]?.baseURL || '');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setBaseURL(e.target.value);
        setError('');
        setSuccess('')
    };

    const validateUrl = (url: string): boolean => {
        try {
            new URL(url); // Attempt to create a URL object
            return true;
        } catch (error) {
            return false;
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if(!baseURL) {
            updateBaseURL()
            setSuccess('Url cleared')
            return
        }

        if (!validateUrl(baseURL)) {
            setError('Invalid URL format.');
            return;
        }

        updateBaseURL();
    };

    const updateBaseURL = async () => {
        await updateSettings({
            providerSettings: {
                ...settings?.providerSettings,
                [provider]: {
                    ...settings?.providerSettings[provider],
                    baseURL: baseURL.replace(/\/$/, ''),
                }
            }
        });

        setSuccess(`Set ${provider} base URL: ${baseURL}`);
    }

    return <div className="space-y-2">
        <form onSubmit={handleSubmit}>
            <div className='flex items-start justify-between flex-col sm:flex-row sm:items-center gap-4'>
                <div>
                    <Input
                        type="text"
                        name={`${provider}BaseUrl`}
                        placeholder="http://example:port"
                        className="border border-gray-300 dark:border-gray-700 rounded-md p-2 w-full"
                        value={baseURL}
                        onChange={handleInputChange}
                    />
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                        {`This is the base URL for ${provider}. Default uses localhost`}
                    </div>
                    {error && <div className="text-red-500 text-sm mt-1">{error}</div>}
                    {success && <div className="text-green-500 text-sm">{success}</div>}
                </div>
                <Button type={'submit'}>Save</Button>
            </div>
        </form>
    </div>
}