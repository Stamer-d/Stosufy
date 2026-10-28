import http.server, os, sys
root = sys.argv[1]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s,*a,**k): super().__init__(*a, directory=root, **k)
    def send_error(s, code, message=None, explain=None):
        if code == 404:
            body = open(os.path.join(root,'Stosufy','404.html'),'rb').read()
            s.send_response(404); s.send_header('Content-Type','text/html'); s.end_headers(); s.wfile.write(body)
        else: super().send_error(code, message, explain)
http.server.ThreadingHTTPServer(('127.0.0.1', 5288), H).serve_forever()
