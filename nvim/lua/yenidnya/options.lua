local opt = vim.opt

vim.g.mapleader = " "

opt.number = true
opt.relativenumber = true

vim.scriptencoding = "utf-8"
opt.encoding = "utf-8"
opt.fileencoding = "utf-8"

opt.scrolloff = 5
opt.sidescrolloff = 5

opt.hlsearch = true
opt.incsearch = true

opt.mouse = "a"

-- Over SSH outside tmux, copy to the client terminal with OSC 52. Paste returns the last copy,
-- because terminals such as Alacritty refuse OSC 52 reads by default.
if vim.env.SSH_TTY and not vim.env.TMUX then
	local osc52 = require("vim.ui.clipboard.osc52")
	local last = { {}, "v" }
	local function copy(reg)
		local send = osc52.copy(reg)
		return function(lines, regtype)
			last = { lines, regtype }
			send(lines)
		end
	end
	local function paste()
		return last
	end
	vim.g.clipboard = {
		name = "OSC 52",
		copy = { ["+"] = copy("+"), ["*"] = copy("*") },
		paste = { ["+"] = paste, ["*"] = paste },
	}
end
opt.clipboard:append("unnamedplus")

opt.tabstop = 4
opt.shiftwidth = 4
opt.expandtab = true

opt.ignorecase = true
opt.smartcase = true

opt.swapfile = false
opt.autoread = true

opt.cursorline = true
opt.termguicolors = true

opt.foldcolumn = "0"
opt.foldlevel = 99
opt.foldlevelstart = 99
opt.foldenable = true

vim.api.nvim_create_autocmd("TextYankPost", {
	callback = function()
		vim.highlight.on_yank({
			higroup = "IncSearch",
			timeout = 200,
		})
	end,
})

opt.updatetime = 300
opt.timeoutlen = 500
