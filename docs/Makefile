# Minimal makefile for Sphinx documentation
#

# You can set these variables from the command line, and also
# from the environment for the first two.
SPHINXOPTS    ?=
SPHINXBUILD   ?= sphinx-build
SOURCEDIR     = source
BUILDDIR      = build

SPHINXINTL    ?= sphinx-intl

# Every language the docs are built in (the first is the source language), and
# the gettext catalogues that get translated: the landing page and the user
# manual. The developer pages and the API reference stay in English.
LANGUAGES     = en ca
TRANSLATIONS  = ca
PO_SCOPE      = index.pot manual

# Put it first so that "make" without argument is like "make help".
help:
	@$(SPHINXBUILD) -M help "$(SOURCEDIR)" "$(BUILDDIR)" $(SPHINXOPTS) $(O)

.PHONY: help Makefile site po

# Every language, side by side in $(BUILDDIR)/site/<lang>/ with a language
# switcher, and a root index.html that sends you to English. Each language
# keeps its own doctrees so switching between them doesn't force a full
# rebuild.
site:
	@for lang in $(LANGUAGES); do \
		$(SPHINXBUILD) -b html -d "$(BUILDDIR)/doctrees/$$lang" \
			-D language=$$lang -A docs_switcher=1 $(SPHINXOPTS) $(O) \
			"$(SOURCEDIR)" "$(BUILDDIR)/site/$$lang" || exit 1; \
	done
	@printf '<!doctype html>\n<meta http-equiv="refresh" content="0; url=en/index.html">\n' \
		> "$(BUILDDIR)/site/index.html"
	@echo "Build finished. The pages are in $(BUILDDIR)/site/<language>/."

# Re-extract the translatable text and merge it into the .po files under
# locale/<lang>/LC_MESSAGES/. New paragraphs arrive untranslated, changed ones
# arrive marked fuzzy with the old translation as a starting point. Only the
# catalogues in PO_SCOPE are carried over.
po:
	@$(SPHINXBUILD) -b gettext -d "$(BUILDDIR)/doctrees/gettext" $(SPHINXOPTS) $(O) \
		"$(SOURCEDIR)" "$(BUILDDIR)/gettext"
	@rm -rf "$(BUILDDIR)/gettext-scope" && mkdir -p "$(BUILDDIR)/gettext-scope"
	@cd "$(BUILDDIR)/gettext" && cp -r --parents $(PO_SCOPE) ../gettext-scope/
	@for lang in $(TRANSLATIONS); do \
		$(SPHINXINTL) update -p "$(BUILDDIR)/gettext-scope" -d locale -l $$lang || exit 1; \
	done

# Catch-all target: route all unknown targets to Sphinx using the new
# "make mode" option.  $(O) is meant as a shortcut for $(SPHINXOPTS).
%: Makefile
	@$(SPHINXBUILD) -M $@ "$(SOURCEDIR)" "$(BUILDDIR)" $(SPHINXOPTS) $(O)
