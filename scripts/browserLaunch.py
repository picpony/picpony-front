import os


def browser_options():
    executable = os.environ.get('PICPONY_BROWSER')
    if executable:
        return {'executable_path': executable}
    channel = os.environ.get('HERO_BROWSER_CHANNEL', 'msedge')
    return {} if channel == 'chromium' else {'channel': channel}
