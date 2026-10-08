/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { app } from 'electron';
import * as fs from 'fs-extra';
import * as path from 'path';
import { DEFAULT_SETTINGS } from './default-settings';

export class SettingsStore {
    private data: Record<string, any> = {};

    public constructor() {
        this.load();
        this.applyDefaults();
    }

    private getSettingsFilePath(): string {
        return path.join(app.getPath('userData'), 'config.json');
    }

    private load() {
        try {
            const filePath = this.getSettingsFilePath();
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                if (content.trim().length > 0) {
                    this.data = JSON.parse(content);
                }
            } else {
                const legacyPath = path.join(app.getPath('appData'), 'Dopamine', 'config.json');
                if (fs.existsSync(legacyPath)) {
                    const content = fs.readFileSync(legacyPath, 'utf-8');
                    if (content.trim().length > 0) {
                        this.data = JSON.parse(content);
                    }
                }
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
            this.data = {};
        }
    }

    private applyDefaults() {
        let changed = false;
        for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
            if (!(key in this.data)) {
                this.data[key] = defaultValue;
                changed = true;
            }
        }

        const legacyPath = path.join(app.getPath('appData'), 'Dopamine', 'config.json');
        if (fs.existsSync(legacyPath)) {
            try {
                const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
                if (legacy.closeToNotificationArea === true && this.data.closeToNotificationArea !== true) {
                    this.data.closeToNotificationArea = true;
                    changed = true;
                }
            } catch {}
        }

        if (changed) this.save();
    }

    private save() {
        try {
            const filePath = this.getSettingsFilePath();
            fs.ensureDirSync(path.dirname(filePath));
            const tmpPath = filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
            fs.renameSync(tmpPath, filePath);
        } catch (err) {
            console.error('Failed to save settings:', err);
        }
    }

    public get<T = any>(key: string): T {
        return this.data[key] as T;
    }

    public set<T = any>(key: string, value: T): void {
        this.data[key] = value;
        this.save();
    }

    public getAll(): Record<string, any> {
        return { ...this.data };
    }
}
