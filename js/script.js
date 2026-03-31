document.addEventListener("DOMContentLoaded", function () {
    var navLinks = document.querySelectorAll(".nav-menu a");
    var sections = document.querySelectorAll("section[id]");
    var navbar = document.querySelector(".navbar");
    var citationBox = document.querySelector(".citation-box");

    navLinks.forEach(function (link) {
        link.addEventListener("click", function (event) {
            var href = this.getAttribute("href");
            var target = document.querySelector(href);
            if (target === null) {
                return;
            }
            event.preventDefault();
            window.scrollTo({
                top: target.offsetTop - 80,
                behavior: "smooth"
            });
        });
    });

    window.addEventListener("scroll", function () {
        if (navbar !== null) {
            if (window.scrollY > 40) {
                navbar.style.background = "rgba(255, 255, 255, 0.98)";
                navbar.style.boxShadow = "0 2px 20px rgba(0, 0, 0, 0.08)";
            } else {
                navbar.style.background = "rgba(255, 255, 255, 0.95)";
                navbar.style.boxShadow = "none";
            }
        }

        var currentSection = "";
        sections.forEach(function (section) {
            var top = section.offsetTop - 120;
            var height = section.offsetHeight;
            if (window.pageYOffset >= top && window.pageYOffset < top + height) {
                currentSection = section.getAttribute("id");
            }
        });

        navLinks.forEach(function (link) {
            link.classList.remove("active");
            if (link.getAttribute("href") === "#" + currentSection) {
                link.classList.add("active");
            }
        });
    });

    if (citationBox !== null) {
        citationBox.style.cursor = "pointer";
        citationBox.title = "Click to copy citation";
        citationBox.addEventListener("click", function () {
            var code = citationBox.querySelector("code");
            if (code === null) {
                return;
            }
            navigator.clipboard.writeText(code.textContent || "").then(function () {
                citationBox.classList.add("copied");
                setTimeout(function () {
                    citationBox.classList.remove("copied");
                }, 1400);
            });
        });
    }
});
