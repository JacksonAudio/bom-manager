/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
    colors: {
        primary: '#533afd',
        secondary: '#50617a',
        accent: '#e8e9ff',
        'neutral-50': '#000000',
        'neutral-100': '#ffffff',
        'neutral-200': '#101010',
        background: '#ffffff',
        foreground: '#000000'
    },
    fontFamily: {
        sans: [
            'sohne-var',
            'sans-serif'
        ]
    },
    fontSize: {
        '8': [
            '8px',
            {
                lineHeight: '8.96px'
            }
        ],
        '9': [
            '9px',
            {
                lineHeight: 'normal'
            }
        ],
        '10': [
            '10px',
            {
                lineHeight: '15px',
                letterSpacing: '0.1px'
            }
        ],
        '11': [
            '11px',
            {
                lineHeight: '16px'
            }
        ],
        '12': [
            '12px',
            {
                lineHeight: 'normal'
            }
        ],
        '14': [
            '14px',
            {
                lineHeight: '14px'
            }
        ],
        '15': [
            '15px',
            {
                lineHeight: 'normal'
            }
        ],
        '16': [
            '16px',
            {
                lineHeight: 'normal'
            }
        ],
        '18': [
            '18px',
            {
                lineHeight: '25.2px'
            }
        ],
        '22': [
            '22px',
            {
                lineHeight: '24.2px',
                letterSpacing: '-0.22px'
            }
        ],
        '26': [
            '26px',
            {
                lineHeight: 'normal'
            }
        ],
        '32': [
            '32px',
            {
                lineHeight: '35.2px',
                letterSpacing: '-0.64px'
            }
        ],
        '48': [
            '48px',
            {
                lineHeight: '55.2px',
                letterSpacing: '-0.96px'
            }
        ],
        '56': [
            '56px',
            {
                lineHeight: '57.68px',
                letterSpacing: '-1.4px'
            }
        ]
    },
    spacing: {
        '2': '4px',
        '5': '10px',
        '7': '14px',
        '10': '20px',
        '12': '24px',
        '14': '28px',
        '16': '32px',
        '18': '36px',
        '20': '40px',
        '24': '48px',
        '26': '52px',
        '30': '60px',
        '32': '64px',
        '36': '72px',
        '40': '80px',
        '48': '96px',
        '170': '340px',
        '183': '366px',
        '1px': '1px',
        '7px': '7px',
        '17px': '17px'
    },
    borderRadius: {
        xs: '1px',
        sm: '4px',
        md: '8px',
        lg: '16px',
        full: '100px'
    },
    boxShadow: {
        sm: 'rgba(23, 23, 23, 0.06) 0px 3px 6px 0px',
        md: 'rgba(0, 0, 0, 0.05) 0px 12px 15px 0px, rgba(0, 0, 0, 0.05) 0px 0px 0px 1px, rgba(0, 0, 0, 0.08) 0px 5px 9px 0px',
        xl: 'rgba(0, 0, 0, 0.1) 0px 30px 60px -50px, rgba(50, 50, 93, 0.25) 0px 30px 60px -10px'
    }
},
  },
};
