# KanbanMF — top-level convenience targets.
#
#   make docs            build the HTML documentation into docs/build/html
#   make run backend     run the API dev server (auto-reloads)
#   make run frontend    run the Vite dev server (HMR)
#
# Everything Python comes from the virtualenv at .venv/, so none of these
# require it to be activated first.

VENV := $(CURDIR)/.venv/bin

# `make run backend` is two goals to make: "run" and "backend". Read the second
# one here and let the no-op rule below swallow it.
TARGET := $(word 2,$(MAKECMDGOALS))

.PHONY: help docs run backend frontend

help:
	@sed -n '3,5p' $(MAKEFILE_LIST) | sed 's/^# \?//'

docs:
	$(MAKE) -C docs html SPHINXBUILD="$(VENV)/sphinx-build"

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
