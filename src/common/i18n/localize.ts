// English-only localization - simplified
export class I18n {
    localize(key: string, defaultValue: string, ...args: string[]): string {
        const message = defaultValue;
        return message.replace(/%\d+%/g, (match: string) => {
            const index = match.replace(/%/g, '');
            return args[Number(index)] || '';
        });
    }
}

export const i18n = new I18n();
