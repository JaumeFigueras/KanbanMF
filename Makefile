# KanbanMF — top-level convenience targets.
#
#   make docs            build the HTML documentation, every language, into docs/build/site
#   make docs-po         refresh the docs' translation catalogues (docs/locale/)
#   make screenshots     reseed the demo data and retake the manual's screenshots
#   make test            run the backend test suite (TEST_ARGS="-k oauth" to narrow it)
#   make test-cov        the same, with a coverage report in backend/test/coverage-reports
#   make run backend     run the API dev server (auto-reloads)
#   make run frontend    run the Vite dev server (HMR)
#   make deploy          update a production checkout: pull, migrate, restart, build
#
# Everything Python comes from the virtualenv at .venv/, so none of these
# require it to be activated first.

VENV := $(CURDIR)/.venv/bin

# `make run backend` is two goals to make: "run" and "backend". Read the second
# one here and let the no-op rule below swallow it.
TARGET := $(word 2,$(MAKECMDGOALS))

.PHONY: help docs docs-po screenshots test test-cov run backend frontend deploy

help:
	@sed -n '3,10p' $(MAKEFILE_LIST) | sed 's/^# \?//'

docs:
	$(MAKE) -C docs site SPHINXBUILD="$(VENV)/sphinx-build"

docs-po:
	$(MAKE) -C docs po SPHINXBUILD="$(VENV)/sphinx-build" SPHINXINTL="$(VENV)/sphinx-intl"

# Needs both dev servers running (make run backend / make run frontend). Each
# language's demo users and their boards are deleted and rebuilt first; nothing
# else in the database is touched. See docs/screenshots/seed.py.
SCREENSHOT_LANGUAGES := en ca

screenshots:
	@for lang in $(SCREENSHOT_LANGUAGES); do \
		$(VENV)/python docs/screenshots/seed.py --lang $$lang && \
		$(VENV)/python docs/screenshots/capture.py --lang $$lang || exit 1; \
	done

# The backend's tests, against throw-away PostgreSQL databases (see
# backend/test/conftest.py): nothing touches the development database.
# Extra pytest arguments go in TEST_ARGS, e.g. make test TEST_ARGS="-x -k oauth".
TEST_ARGS ?=

test:
	cd backend && $(VENV)/python -m pytest -q $(TEST_ARGS) ./test

# Line coverage of src/, summarised in the terminal (files below 100 %) and as
# browsable HTML in backend/test/coverage-reports/index.html (gitignored).
test-cov:
	cd backend && $(VENV)/python -m pytest -q $(TEST_ARGS) --cov=./src \
		--cov-report=term:skip-covered --cov-report=html:./test/coverage-reports ./test

run:
ifeq ($(TARGET),backend)
	cd backend && $(VENV)/uvicorn src.main:app --reload
else ifeq ($(TARGET),frontend)
	cd frontend && npm run dev
else
	@echo "usage: make run [backend|frontend]" >&2; exit 1
endif

# Consumed by `run`; nothing to do on their own.
backend frontend:
	@:

# Run on the server, from the production checkout. make stops at the first
# failing step, so a failed pull, install or migration leaves the old backend
# running. The installs are no-ops when nothing changed.
deploy:
	git pull
	$(VENV)/pip install -q -r backend/requirements.txt
	cd backend && $(VENV)/alembic upgrade head
	sudo systemctl restart kanbanmf-backend
	cd frontend && npm ci && npm run build
