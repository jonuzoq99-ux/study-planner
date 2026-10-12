import html
import json
import re
from datetime import datetime
from http.cookiejar import CookieJar
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


PORTAL_URL = "https://estudy.iiau.uz"
HOST = "127.0.0.1"
PORT = 8000


class SyncError(Exception):
    pass


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text_parts = []
        self.links = []
        self.rows = []
        self.current_row = None
        self.current_cell = None
        self.current_link = None
        self.heading_parts = None
        self.heading_text = ""

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "a":
            self.current_link = {"href": attributes.get("href", ""), "text": []}
        elif tag == "tr":
            self.current_row = []
        elif tag in ("td", "th") and self.current_row is not None:
            self.current_cell = []
        elif tag == "h1":
            self.heading_parts = []

    def handle_endtag(self, tag):
        if tag == "a" and self.current_link is not None:
            self.current_link["text"] = normalize_space(" ".join(self.current_link["text"]))
            self.links.append(self.current_link)
            self.current_link = None
        elif tag in ("td", "th") and self.current_cell is not None:
            self.current_row.append(normalize_space(" ".join(self.current_cell)))
            self.current_cell = None
        elif tag == "tr" and self.current_row is not None:
            self.rows.append(self.current_row)
            self.current_row = None
        elif tag == "h1" and self.heading_parts is not None:
            self.heading_text = normalize_space(" ".join(self.heading_parts))
            self.heading_parts = None

    def handle_data(self, data):
        value = normalize_space(data)
        if not value:
            return
        self.text_parts.append(value)
        if self.current_link is not None:
            self.current_link["text"].append(value)
        if self.current_cell is not None:
            self.current_cell.append(value)
        if self.heading_parts is not None:
            self.heading_parts.append(value)

    @property
    def text(self):
        return normalize_space(" ".join(self.text_parts))

    @property
    def heading(self):
        return self.heading_text


def normalize_space(value):
    return re.sub(r"\s+", " ", value).strip()


def get_page(opener, path):
    request = Request(
        urljoin(PORTAL_URL, path),
        headers={"User-Agent": "Mozilla/5.0 (compatible; LocalStudyPlanner/1.0)"},
    )
    try:
        with opener.open(request, timeout=20) as response:
            return response.geturl(), response.read().decode("utf-8", "replace")
    except (HTTPError, URLError, TimeoutError) as error:
        raise SyncError("Universitet portaliga ulanishda xatolik yuz berdi. Keyinroq qayta urinib ko‘ring.") from error


def login_to_portal(username, password):
    cookie_jar = CookieJar()
    opener = build_opener(HTTPCookieProcessor(cookie_jar))
    login_url, login_html = get_page(opener, "/login/index.php")
    token_match = re.search(
        r'<input[^>]+name=["\']logintoken["\'][^>]+value=["\']([^"\']*)',
        login_html,
        re.IGNORECASE,
    )
    if not token_match:
        raise SyncError("Portalning kirish shaklini o‘qib bo‘lmadi.")

    form_data = urlencode({
        "username": username,
        "password": password,
        "logintoken": html.unescape(token_match.group(1)),
    }).encode("utf-8")
    request = Request(
        login_url,
        data=form_data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (compatible; LocalStudyPlanner/1.0)",
        },
    )
    try:
        with opener.open(request, timeout=20) as response:
            page = response.read().decode("utf-8", "replace")
            final_url = response.geturl()
    except (HTTPError, URLError, TimeoutError) as error:
        raise SyncError("Portalga kirib bo‘lmadi. Internet aloqasini tekshirib, qayta urinib ko‘ring.") from error

    if "/login/" in urlparse(final_url).path or 'name="logintoken"' in page:
        raise SyncError("Portal loginni qabul qilmadi. Login-parolni tekshiring yoki portalning qo‘shimcha tasdig‘ini bajaring.")
    return opener


def course_links(page_html):
    parser = PageParser()
    parser.feed(page_html)
    courses = {}
    for link in parser.links:
        parsed = urlparse(link["href"])
        if parsed.path.rstrip("/") != "/course/view.php":
            continue
        course_id = parse_qs(parsed.query).get("id", [""])[0]
        if course_id.isdigit() and int(course_id) > 1:
            courses[course_id] = link["text"] or "Fan"
    return courses


def grade_course_links(page_html):
    parser = PageParser()
    parser.feed(page_html)
    courses = {}
    for link in parser.links:
        parsed = urlparse(link["href"])
        if parsed.path.rstrip("/") != "/course/user.php":
            continue
        query = parse_qs(parsed.query)
        course_id = query.get("id", [""])[0]
        user_id = query.get("user", [""])[0]
        if course_id.isdigit() and user_id.isdigit():
            courses[course_id] = {
                "name": link["text"] or "Fan",
                "grade_path": f"{parsed.path}?{parsed.query}",
            }
    return courses


def assignment_links(page_html):
    parser = PageParser()
    parser.feed(page_html)
    assignments = {}
    for link in parser.links:
        parsed = urlparse(link["href"])
        if parsed.path.rstrip("/") != "/mod/assign/view.php":
            continue
        assignment_id = parse_qs(parsed.query).get("id", [""])[0]
        if assignment_id.isdigit():
            assignments[assignment_id] = link["text"]
    return assignments


def parse_due_date(text):
    match = re.search(
        r"\bDue:\s*((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+\d{1,2}\s+[A-Za-z]+\s+\d{4},\s+\d{1,2}:\d{2}\s*(?:AM|PM))",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    try:
        due = datetime.strptime(match.group(1), "%A, %d %B %Y, %I:%M %p")
    except ValueError:
        return None
    return due.strftime("%Y-%m-%dT%H:%M")


def parse_grade(rows):
    for row in rows:
        if len(row) < 2 or "grade" not in row[0].lower():
            continue
        value = row[1].replace(",", ".")
        ratio = re.search(r"(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", value)
        if ratio and float(ratio.group(2)) > 0:
            return round(float(ratio.group(1)) / float(ratio.group(2)) * 100, 1)
        percentage = re.search(r"(\d+(?:\.\d+)?)\s*%", value)
        if percentage:
            return min(100, float(percentage.group(1)))
    return None


def parse_grade_items(rows):
    items = []
    header = None
    for row in rows:
        normalized = [normalize_space(value).casefold() for value in row]
        if "grade item" in normalized and "grade" in normalized and "range" in normalized:
            header = normalized
            break
    if not header:
        return items
    grade_index = header.index("grade")
    range_index = header.index("range")
    percentage_index = header.index("percentage") if "percentage" in header else None

    for row in rows:
        if row is None or row == []:
            continue
        name = normalize_space(row[0])
        if not name or name.casefold() == "grade item":
            continue
        if name.casefold() in ("collapse", "expand"):
            continue

        def cell(index):
            return row[index] if index < len(row) else ""

        grade_text = cell(grade_index).replace(",", ".")
        range_text = cell(range_index).replace(",", ".")
        percentage_text = cell(percentage_index).replace(",", ".") if percentage_index is not None else ""
        score_match = re.search(r"(?<![\w.])(-?\d+(?:\.\d+)?)(?![\w.])", grade_text)
        range_match = re.search(r"0\s*[-–—]\s*(\d+(?:\.\d+)?)", range_text)
        percentage_match = re.search(r"(\d+(?:\.\d+)?)\s*%", percentage_text)

        score = float(score_match.group(1)) if score_match else None
        maximum = float(range_match.group(1)) if range_match else None
        percentage = float(percentage_match.group(1)) if percentage_match else None
        if score is not None and maximum and percentage is None:
            percentage = score / maximum * 100
        elif score is None and percentage is not None:
            score = percentage
            maximum = 100.0

        if score is None and percentage is None:
            continue
        items.append({
            "name": name,
            "score": score,
            "max": maximum,
            "percentage": percentage,
        })
    return items


def course_key(course_name):
    name = course_name.lower()
    if "kriptograf" in name or "cryptograph" in name:
        return "crypto"
    if "tarmoq" in name or "network" in name:
        return "network"
    if "foydalanish" in name or "usage management" in name:
        return "usage"
    if "kotlin" in name:
        return "kotlin"
    if "python" in name:
        return "python"
    return None


def scrape_assignments(opener):
    _, overview_html = get_page(opener, "/grade/report/overview/index.php")
    grade_courses = grade_course_links(overview_html)
    _, courses_html = get_page(opener, "/my/courses.php")
    courses = course_links(courses_html)
    if not courses:
        _, courses_html = get_page(opener, "/my/")
        courses = course_links(courses_html)
    if grade_courses:
        courses = {
            course_id: details["name"]
            for course_id, details in grade_courses.items()
        }
    if not courses:
        raise SyncError("Portalda kurslar topilmadi. Kurslaringizga kirish huquqini tekshiring.")

    results = []
    grades = {}
    for course_id, course_name in courses.items():
        _, course_html = get_page(opener, f"/course/view.php?id={course_id}")
        assignments = assignment_links(course_html)
        grade_path = (
            grade_courses[course_id]["grade_path"]
            if course_id in grade_courses
            else f"/grade/report/user/index.php?id={course_id}"
        )
        _, grade_html = get_page(opener, grade_path)
        grade_parser = PageParser()
        grade_parser.feed(grade_html)
        grade_items = parse_grade_items(grade_parser.rows)
        grade_key = course_key(course_name)
        if grade_key:
            grades[grade_key] = {"name": course_name, "items": grade_items}

        for assignment_id, link_title in assignments.items():
            _, assignment_html = get_page(opener, f"/mod/assign/view.php?id={assignment_id}")
            parser = PageParser()
            parser.feed(assignment_html)
            due_date = parse_due_date(parser.text)
            if not due_date:
                continue

            title = parser.heading or link_title or f"Vazifa {assignment_id}"
            assignment_text = parser.text.lower()
            submitted = (
                "submitted for grading" in assignment_text
                or "submitted" in assignment_text and "draft (not submitted)" not in assignment_text
            )
            assignment = {
                "id": f"portal-{assignment_id}",
                "title": title,
                "course": course_name,
                "dueDate": due_date,
                "priority": "medium",
                "status": "done" if submitted else "pending",
                "grade": parse_grade(parser.rows),
                "source": "portal",
            }
            matching_grade = next(
                (item for item in grade_items if normalize_space(item["name"]).casefold() == normalize_space(title).casefold()),
                None,
            )
            if matching_grade:
                assignment["grade"] = matching_grade["percentage"]
                assignment["maxGrade"] = matching_grade["max"]
            results.append(assignment)

    if not grades:
        raise SyncError("Reyting sahifalaridan baholar olinmadi. Portalda «Reytingim» bo‘limi ochilishini tekshiring.")
    return results, grades


class PlannerHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/sync":
            self.send_json(404, {"error": "Manzil topilmadi."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "So‘rov noto‘g‘ri."})
            return
        if length < 1 or length > 16_384:
            self.send_json(400, {"error": "So‘rov hajmi noto‘g‘ri."})
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Kirish ma’lumotlarini o‘qib bo‘lmadi."})
            return

        username = payload.get("username", "") if isinstance(payload, dict) else ""
        password = payload.get("password", "") if isinstance(payload, dict) else ""
        if not isinstance(username, str) or not isinstance(password, str) or not username or not password:
            self.send_json(400, {"error": "Login va parolni kiriting."})
            return

        try:
            opener = login_to_portal(username, password)
            tasks, grades = scrape_assignments(opener)
        except SyncError as error:
            self.send_json(502, {"error": str(error)})
            return
        finally:
            password = ""
            if isinstance(payload, dict):
                payload["password"] = ""

        self.send_json(200, {"tasks": tasks, "grades": grades})

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        if self.command != "POST":
            super().log_message(format_string, *args)


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    server = LocalServer((HOST, PORT), PlannerHandler)
    print(f"O‘qish reja ishga tushdi: http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
