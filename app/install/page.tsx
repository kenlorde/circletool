import type { Metadata } from 'next';
import { InstallApp } from '@/components/app-installation';
export const metadata: Metadata = { title: 'Install Circletool', description: 'Install Circletool on your iPhone or Android Home Screen.' };
export default function InstallPage() { return <InstallApp />; }
